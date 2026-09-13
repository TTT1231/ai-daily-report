/* global document, window, location */
import {existsSync, readFileSync, writeFileSync, renameSync} from "node:fs";
import {resolve} from "node:path";
import {sha256File, sha256Text} from "./evidence-review.mjs";

export function validateCapturePlan(plan) {
  const errors = [];
  try { if (!["http:", "https:"].includes(new URL(plan.url).protocol)) throw new Error(); }
  catch { errors.push("Capture URL must be http(s)."); }
  if (!Array.isArray(plan.targets) || !plan.targets.length) errors.push("Plan needs fact targets.");
  const identities = new Set();
  for (const target of plan.targets ?? []) {
    if (!target.fact?.trim() || !target.selector?.trim() || !target.expectedText?.length ||
        target.expectedText.some((text) => typeof text !== "string" || !text.trim())) {
      errors.push("Each target needs fact, observed CSS selector and nonempty expectedText strings.");
    }
    if (identities.has(target.fact)) errors.push(`Duplicate fact target: ${target.fact}`);
    identities.add(target.fact);
  }
  if ((plan.hideSelectors ?? []).some((selector) => typeof selector !== "string" || !selector.trim())) {
    errors.push("hideSelectors must contain observed CSS selectors for unrelated UI.");
  }
  return errors;
}

// Runs inside the original page. It only hides explicitly selected unrelated
// nodes; it never reconstructs article text, adds branding, or changes facts.
export function prepareCaptureRegion(target, hideSelectors) {
  window.__evidenceCaptureRestore?.();
  const elements = document.querySelectorAll(target.selector);
  if (elements.length !== 1) throw new Error(`Expected one target, found ${elements.length}`);
  const element = elements[0];
  const normalize = (text) => text.replace(/\s+/g, " ").trim();
  for (const text of target.expectedText) {
    if (!normalize(element.textContent).includes(normalize(text))) {
      throw new Error(`Target does not contain expected fact: ${text}`);
    }
  }
  const hidden = [];
  for (const selector of hideSelectors) {
    for (const node of document.querySelectorAll(selector)) {
      if (node === element || node.contains(element) ||
          target.expectedText.some((text) => normalize(node.textContent).includes(normalize(text)))) {
        throw new Error(`Refusing to hide target or fact-bearing node: ${selector}`);
      }
      hidden.push({node, style: node.getAttribute("style")});
    }
  }
  window.__evidenceCaptureRestore = () => {
    for (const {node, style} of hidden) {
      if (style === null) node.removeAttribute("style"); else node.setAttribute("style", style);
    }
    delete window.__evidenceCaptureRestore;
  };
  for (const {node} of hidden) node.style.setProperty("display", "none", "important");
  element.scrollIntoView({block: "center", behavior: "instant"});
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) throw new Error("Target is not visible.");
  return {width: rect.width, height: rect.height, text: element.innerText, url: location.href};
}

export async function captureEvidenceTargets({plan, directory, run, retryFact, retryReason}) {
  const errors = validateCapturePlan(plan);
  if (errors.length) throw new Error(errors.join("\n"));
  const ledgerPath = resolve(directory, "capture-ledger.json");
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : {schemaVersion: 1, targets: {}};
  if (ledger.schemaVersion !== 1 || !ledger.targets) throw new Error("Invalid capture ledger.");
  const save = () => {
    writeFileSync(`${ledgerPath}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`);
    renameSync(`${ledgerPath}.tmp`, ledgerPath);
  };
  const results = [];
  for (const target of plan.targets) {
    const key = sha256Text(JSON.stringify([plan.url, target.fact]));
    const entry = ledger.targets[key] ??= {url: plan.url, fact: target.fact, attempts: []};
    const last = entry.attempts.at(-1);
    const retry = retryFact === target.fact;
    if (last && !retry) {
      if (last.status === "captured" && existsSync(last.path) && sha256File(last.path) === last.sha256) {
        results.push({...last, fact: target.fact, cached: true});
      } else results.push({fact: target.fact, status: "needs-decision", reason: "Inspect the failure; retry requires --retry-fact and --reason."});
      continue;
    }
    if (retry && !retryReason?.trim()) throw new Error("A retry requires a concrete --reason.");
    if (entry.attempts.length >= 2) {
      results.push({fact: target.fact, status: "exhausted", reason: "Two attempts used for this fact; use another source or exclude unsupported content."});
      continue;
    }
    const attempt = {startedAt: new Date().toISOString(), selector: target.selector,
      hideSelectors: plan.hideSelectors ?? [], reason: retryReason ?? "initial capture", status: "running"};
    entry.attempts.push(attempt);
    save(); // A crash or context interruption must not reset the attempt budget.
    const started = Date.now();
    try {
      const script = `(${prepareCaptureRegion.toString()})(${JSON.stringify(target)}, ${JSON.stringify(plan.hideSelectors ?? [])})`;
      await run(["eval", "--stdin"], script);
      const path = resolve(directory, `${key.slice(0, 20)}-${entry.attempts.length}.png`);
      await run(["screenshot", target.selector, path]);
      const sha256 = sha256File(path);
      Object.assign(attempt, {path, sha256, status: last?.sha256 === sha256 ? "unchanged" : "captured"});
      if (attempt.status === "unchanged") attempt.error = "Pixels identical to previous attempt; do not repeat visual review or capture.";
    } catch (error) {
      Object.assign(attempt, {status: "failed", error: error.message});
    } finally {
      try { await run(["eval", "--stdin"], "window.__evidenceCaptureRestore?.()"); }
      catch (error) { attempt.restoreError = error.message; attempt.status = "failed"; }
      attempt.elapsedMs = Date.now() - started;
      save();
    }
    results.push({...attempt, fact: target.fact});
  }
  return {ledgerPath, results};
}
