import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {resolve} from "node:path";
import {readImageDimensions} from "../image-dims.mjs";

// 图片样本来自 test/mock/images/（与其它 mock 资产同源），不依赖 demo/ 目录。
const sampleDir = resolve(import.meta.dirname, "../../../test/mock");

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

test("readImageDimensions reads lossy VP8 WebP dimensions as little-endian", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), {recursive: true});
  const payload = Buffer.from([
    0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x41, 0x01, 0xf0, 0x00,
  ]);
  const header = Buffer.alloc(20);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(22, 4);
  header.write("WEBP", 8, "ascii");
  header.write("VP8 ", 12, "ascii");
  header.writeUInt32LE(payload.length, 16);
  await writeFile(join(dir, "images/lossy.webp"), Buffer.concat([header, payload]));

  assert.deepEqual(readImageDimensions("images/lossy.webp", dir), {
    width: 321,
    height: 240,
  });
  await rm(dir, {recursive: true, force: true});
});

test("readImageDimensions reads GIF89a dimensions as little-endian", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), {recursive: true});
  const gif = Buffer.alloc(10);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(321, 6);
  gif.writeUInt16LE(240, 8);
  await writeFile(join(dir, "images/a.gif"), gif);
  assert.deepEqual(readImageDimensions("images/a.gif", dir), {width: 321, height: 240});
  await rm(dir, {recursive: true, force: true});
});

test("readImageDimensions reads AVIF ispe dimensions as big-endian", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), {recursive: true});
  // ftyp 盒（size=8 + "ftyp"）+ ispe FullBox（[size][ispe][版本/标志][width 大端][height 大端]）
  const ftyp = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x66, 0x74, 0x79, 0x70]);
  const ispe = Buffer.alloc(20);
  ispe.writeUInt32BE(20, 0);
  ispe.write("ispe", 4, "ascii");
  ispe.writeUInt32BE(0, 8);
  ispe.writeUInt32BE(321, 12);
  ispe.writeUInt32BE(240, 16);
  await writeFile(join(dir, "images/a.avif"), Buffer.concat([ftyp, ispe]));
  assert.deepEqual(readImageDimensions("images/a.avif", dir), {width: 321, height: 240});
  await rm(dir, {recursive: true, force: true});
});

test("readImageDimensions returns null for missing file and path escape", () => {
  assert.equal(readImageDimensions("images/nope.png", sampleDir), null);
  assert.equal(readImageDimensions("../escape.png", sampleDir), null);
});
