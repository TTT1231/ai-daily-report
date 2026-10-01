/* global document, window, location */
import {existsSync, readFileSync, writeFileSync, renameSync} from "node:fs";
import {resolve} from "node:path";
import {inflateSync} from "node:zlib";
import {sha256File, sha256Text} from "./evidence-review.mjs";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

// Inspect actual pixels, not compression ratio: a small source logo or a short
// paragraph can legitimately compress well. Only nearly uniform images need
// triage. The decoder is deliberately limited to browser screenshot RGB/RGBA
// PNGs; unsupported formats remain subject to visual review.
function screenshotLooksEmpty(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const channels = bytes[25] === 2 ? 3 : bytes[25] === 6 ? 4 : 0;
  if (!width || !height || width * height > 16_000_000 || bytes[24] !== 8 ||
      !channels || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) return false;
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  if (!chunks.length) return false;
  const stride = width * channels;
  let data;
  try {
    data = inflateSync(Buffer.concat(chunks), {maxOutputLength: (stride + 1) * height});
  } catch { return false; }
  if (data.length !== (stride + 1) * height) return false;
  let previous = Buffer.alloc(stride);
  let current = Buffer.alloc(stride);
  const reference = [];
  for (let row = 0; row < height; row++) {
    const rowOffset = row * (stride + 1);
    const filter = data[rowOffset];
    if (filter > 4) return false;
    for (let column = 0; column < stride; column++) {
      const left = column >= channels ? current[column - channels] : 0;
      const above = previous[column];
      const upperLeft = column >= channels ? previous[column - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
        : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft);
      current[column] = (data[rowOffset + 1 + column] + predictor) & 255;
    }
    for (let column = 0; column < stride; column += channels) {
      const alpha = channels === 4 ? current[column + 3] / 255 : 1;
      for (let channel = 0; channel < 3; channel++) {
        const value = Math.round(current[column + channel] * alpha + 255 * (1 - alpha));
        reference[channel] ??= value;
        if (Math.abs(value - reference[channel]) > 2) return false;
      }
    }
    [previous, current] = [current, previous];
  }
  return true;
}

const capturePlanFingerprint = (target, hideSelectors) =>
  sha256Text(JSON.stringify([target.selector, target.expectedText, hideSelectors]));

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
export async function prepareCaptureRegion(target, hideSelectors) {
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
  // Scroll-reveal content may not paint during the same layout pass. Background
  // tabs can throttle animation frames, so the wait must remain bounded.
  await new Promise((resolvePaint) => {
    const timer = window.setTimeout(resolvePaint, 250);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      window.clearTimeout(timer);
      resolvePaint();
    }));
  });
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) throw new Error("Target is not visible.");
  if (element.checkVisibility?.({checkOpacity: true, checkVisibilityCSS: true,
    contentVisibilityAuto: true}) === false) throw new Error("Target has not painted visibly.");
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
    const planFingerprint = capturePlanFingerprint(target, plan.hideSelectors ?? []);
    const key = sha256Text(JSON.stringify([plan.url, target.fact]));
    const entry = ledger.targets[key] ??= {url: plan.url, fact: target.fact, attempts: []};
    const last = entry.attempts.at(-1);
    const retry = retryFact === target.fact;
    if (last && !retry) {
      if (last.status === "captured" && existsSync(last.path) && sha256File(last.path) === last.sha256) {
        if (screenshotLooksEmpty(last.path)) {
          last.status = "suspect-blank";
          last.error = "PNG is nearly uniform. Inspect it; if blank, capture the visible page viewport instead of this element.";
          save();
          results.push({...last, fact: target.fact});
        } else if (last.planFingerprint === planFingerprint) {
          results.push({...last, fact: target.fact, cached: true});
        } else results.push({fact: target.fact, status: "needs-decision",
          reason: "Capture selector, expectedText or hideSelectors changed (or old capture has no plan fingerprint); retry requires --retry-fact and --reason."});
      } else results.push({fact: target.fact, status: "needs-decision", reason: "Inspect the failure; retry requires --retry-fact and --reason."});
      continue;
    }
    if (retry && !retryReason?.trim()) throw new Error("A retry requires a concrete --reason.");
    if (entry.attempts.length >= 2) {
      results.push({fact: target.fact, status: "exhausted", reason: "Two attempts used for this fact; use another source or exclude unsupported content."});
      continue;
    }
    const attempt = {startedAt: new Date().toISOString(), selector: target.selector,
      hideSelectors: plan.hideSelectors ?? [], planFingerprint,
      reason: retryReason ?? "initial capture", status: "running"};
    entry.attempts.push(attempt);
    save(); // A crash or context interruption must not reset the attempt budget.
    const started = Date.now();
    try {
      const script = `(${prepareCaptureRegion.toString()})(${JSON.stringify(target)}, ${JSON.stringify(plan.hideSelectors ?? [])})`;
      await run(["eval", "--stdin"], script);
      const path = resolve(directory, `${key.slice(0, 20)}-${entry.attempts.length}.png`);
      await run(["screenshot", target.selector, path]);
      const sha256 = sha256File(path);
      const suspectBlank = screenshotLooksEmpty(path);
      Object.assign(attempt, {path, sha256, status: last?.sha256 === sha256 ? "unchanged" : suspectBlank ? "suspect-blank" : "captured"});
      if (attempt.status === "suspect-blank") attempt.error = "PNG is nearly uniform. Inspect it; if blank, capture the visible page viewport instead of this element.";
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
