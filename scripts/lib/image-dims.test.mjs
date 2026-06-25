import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {resolve} from "node:path";
import {readImageDimensions} from "./image-dims.mjs";

const sampleDir = resolve(import.meta.dirname, "../../data-scheme-sample-1");

test("readImageDimensions reads real PNG/WebP/JPEG fixtures", () => {
  const png = readImageDimensions("images/codex-reset.png", sampleDir);
  assert.ok(png, "PNG must decode");
  assert.ok(Number.isInteger(png.width) && png.width > 0, "PNG width positive int");
  assert.ok(Number.isInteger(png.height) && png.height > 0, "PNG height positive int");

  const webp = readImageDimensions("images/topic-2419173-de50252f0a.webp", sampleDir);
  assert.ok(webp && webp.width > 0 && webp.height > 0, "WebP must decode");

  const jpg = readImageDimensions("images/topic-2419173-e551af32e2.jpg", sampleDir);
  assert.ok(jpg && jpg.width > 0 && jpg.height > 0, "JPEG must decode");
});

test("readImageDimensions reads SVG width/height and viewBox", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), {recursive: true});
  await writeFile(
    join(dir, "images/a.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>',
  );
  assert.deepEqual(readImageDimensions("images/a.svg", dir), {width: 120, height: 80});

  await writeFile(
    join(dir, "images/b.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"></svg>',
  );
  assert.deepEqual(readImageDimensions("images/b.svg", dir), {width: 300, height: 200});
  await rm(dir, {recursive: true, force: true});
});

test("readImageDimensions returns null for missing file and path escape", () => {
  assert.equal(readImageDimensions("images/nope.png", sampleDir), null);
  assert.equal(readImageDimensions("../escape.png", sampleDir), null);
});
