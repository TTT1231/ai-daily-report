import test from "node:test";
import assert from "node:assert/strict";
import {buildGenerateSvgAllowedTools, buildGenerateSvgArgs} from "./claude-allowlist.mjs";

test("buildGenerateSvgArgs includes incremental generation constraints by default", () => {
  const args = buildGenerateSvgArgs();
  assert.match(args.at(-1), /^\/generate-svg/);
  assert.match(args.at(-1), /Incremental generation constraint/);
  assert.match(args.at(-1), /Do not rewrite, redesign, delete, or reassign valid existing icons/);
});

test("buildGenerateSvgArgs can add the automation constraint", () => {
  const args = buildGenerateSvgArgs({automation: true});
  assert.match(args.at(-1), /^\/generate-svg/);
  assert.match(args.at(-1), /Automation constraint/);
  assert.match(args.at(-1), /Do not start bun run dev/);
});

test("buildGenerateSvgArgs passes preflight issues to the skill prompt", () => {
  const args = buildGenerateSvgArgs({
    preflightErrors: ['stories[0].tabs[1]: missing "icon" field — icon generation did not finish'],
    iconTargets: ["icons/topic-1-tab-2.svg"],
  });

  assert.match(args.at(-1), /Preflight issues to fix:/);
  assert.match(args.at(-1), /stories\[0\]\.tabs\[1\]/);
  assert.match(args.at(-1), /Writable icon targets:\n- icons\/topic-1-tab-2\.svg/);
});

test("buildGenerateSvgAllowedTools restricts icon writes to preflight targets", () => {
  const tools = buildGenerateSvgAllowedTools({
    iconTargets: ["icons/topic-1-tab-2.svg"],
  });

  assert.ok(tools.includes("Write(data-scheme/icons/topic-1-tab-2.svg)"));
  assert.ok(tools.includes("Edit(data-scheme/icons/topic-1-tab-2.svg)"));
  assert.ok(!tools.includes("Write(data-scheme/icons/**)"));
  assert.ok(!tools.includes("Edit(data-scheme/icons/**)"));
});

test("buildGenerateSvgAllowedTools falls back when a target cannot be safely scoped", () => {
  const tools = buildGenerateSvgAllowedTools({
    iconTargets: ["icons/topic-1-tab-2.svg", "icons/topic 1-tab 3.svg"],
  });

  assert.ok(tools.includes("Write(data-scheme/icons/**)"));
  assert.ok(tools.includes("Edit(data-scheme/icons/**)"));
});
