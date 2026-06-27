import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {validateReportIcons} from "./icon-validation.mjs";

const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path d="M20 76 48 16l28 60Z" fill="#2563eb"/></svg>`;

async function createDataDir() {
  const dataDir = await mkdtemp(join(tmpdir(), "icon-validation-"));
  await mkdir(join(dataDir, "icons"));
  return dataDir;
}

function reportWithTabs(tabs) {
  return {
    intro: {
      id: "intro",
      tabs,
    },
    stories: [],
  };
}

test("validateReportIcons accepts existing valid SVG icons", async () => {
  const dataDir = await createDataDir();
  await writeFile(join(dataDir, "icons", "intro-group-1.svg"), validSvg);

  const result = validateReportIcons(
    reportWithTabs([{id: "intro-group-1", icon: "icons/intro-group-1.svg"}]),
    {dataDir},
  );

  assert.equal(result.totalTabs, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("validateReportIcons reports missing icon fields and files", async () => {
  const dataDir = await createDataDir();

  const result = validateReportIcons(
    reportWithTabs([
      {id: "intro-group-1"},
      {id: "intro-group-2", icon: "icons/missing.svg"},
    ]),
    {dataDir},
  );

  assert.deepEqual(result.errors, [
    'intro.tabs[0]: missing "icon" field — icon generation did not finish',
    "intro.tabs[1]: icon file not found: icons/missing.svg",
  ]);
  assert.deepEqual(result.iconTargets, ["icons/intro-group-1.svg", "icons/missing.svg"]);
});

test("validateReportIcons reports invalid SVG content", async () => {
  const dataDir = await createDataDir();
  await writeFile(join(dataDir, "icons", "bad.svg"), `<svg><rect width="96" height="96"/></svg>`);

  const result = validateReportIcons(
    reportWithTabs([{id: "intro-group-1", icon: "icons/bad.svg"}]),
    {dataDir},
  );

  assert.deepEqual(result.errors, [
    'icons/bad.svg: SVG must have viewBox="0 0 96 96"',
    "icons/bad.svg: SVG must have xmlns attribute",
    "icons/bad.svg: SVG must use a transparent canvas without a full-size background rect",
  ]);
});

test("validateReportIcons warns about orphan SVG files", async () => {
  const dataDir = await createDataDir();
  await writeFile(join(dataDir, "icons", "used.svg"), validSvg);
  await writeFile(join(dataDir, "icons", "orphan.svg"), validSvg);

  const result = validateReportIcons(
    reportWithTabs([{id: "intro-group-1", icon: "icons/used.svg"}]),
    {dataDir},
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [
    "icons/: orphan files not referenced by any tab: icons/orphan.svg",
  ]);
});
