import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { readImageDimensions, readImageOrientation } from "../image-dims.mjs";

// 图片样本来自 test/mock/images/（与其它 mock 资产同源），不依赖 demo/ 目录。
const sampleDir = resolve(import.meta.dirname, "../../../test/mock");

test("readImageDimensions reads real PNG/WebP/JPEG fixtures", () => {
  const png = readImageDimensions("images/codex-reset.png", sampleDir);
  assert.ok(png, "PNG must decode");
  assert.ok(
    Number.isInteger(png.width) && png.width > 0,
    "PNG width positive int",
  );
  assert.ok(
    Number.isInteger(png.height) && png.height > 0,
    "PNG height positive int",
  );

  const webp = readImageDimensions(
    "images/topic-2419173-de50252f0a.webp",
    sampleDir,
  );
  assert.ok(webp && webp.width > 0 && webp.height > 0, "WebP must decode");

  const jpg = readImageDimensions(
    "images/topic-2419173-e551af32e2.jpg",
    sampleDir,
  );
  assert.ok(jpg && jpg.width > 0 && jpg.height > 0, "JPEG must decode");
});

test("readImageDimensions reads SVG width/height and viewBox", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), { recursive: true });
  await writeFile(
    join(dir, "images/a.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>',
  );
  assert.deepEqual(readImageDimensions("images/a.svg", dir), {
    width: 120,
    height: 80,
  });

  await writeFile(
    join(dir, "images/b.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"></svg>',
  );
  assert.deepEqual(readImageDimensions("images/b.svg", dir), {
    width: 300,
    height: 200,
  });
  await rm(dir, { recursive: true, force: true });
});

test("readImageDimensions reads lossy VP8 WebP dimensions as little-endian", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), { recursive: true });
  const payload = Buffer.from([
    0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x41, 0x01, 0xf0, 0x00,
  ]);
  const header = Buffer.alloc(20);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(22, 4);
  header.write("WEBP", 8, "ascii");
  header.write("VP8 ", 12, "ascii");
  header.writeUInt32LE(payload.length, 16);
  await writeFile(
    join(dir, "images/lossy.webp"),
    Buffer.concat([header, payload]),
  );

  assert.deepEqual(readImageDimensions("images/lossy.webp", dir), {
    width: 321,
    height: 240,
  });
  await rm(dir, { recursive: true, force: true });
});

test("readImageDimensions reads GIF89a dimensions as little-endian", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), { recursive: true });
  const gif = Buffer.alloc(10);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(321, 6);
  gif.writeUInt16LE(240, 8);
  await writeFile(join(dir, "images/a.gif"), gif);
  assert.deepEqual(readImageDimensions("images/a.gif", dir), {
    width: 321,
    height: 240,
  });
  await rm(dir, { recursive: true, force: true });
});

test("readImageDimensions reads AVIF ispe dimensions as big-endian", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), { recursive: true });
  // ftyp 盒（size=8 + "ftyp"）+ ispe FullBox（[size][ispe][版本/标志][width 大端][height 大端]）
  const ftyp = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x66, 0x74, 0x79, 0x70]);
  const ispe = Buffer.alloc(20);
  ispe.writeUInt32BE(20, 0);
  ispe.write("ispe", 4, "ascii");
  ispe.writeUInt32BE(0, 8);
  ispe.writeUInt32BE(321, 12);
  ispe.writeUInt32BE(240, 16);
  await writeFile(join(dir, "images/a.avif"), Buffer.concat([ftyp, ispe]));
  assert.deepEqual(readImageDimensions("images/a.avif", dir), {
    width: 321,
    height: 240,
  });
  await rm(dir, { recursive: true, force: true });
});

test("readImageDimensions prefers the main AVIF canvas over an earlier thumbnail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "imgdims-"));
  await mkdir(join(dir, "images"), { recursive: true });
  const ftyp = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x66, 0x74, 0x79, 0x70]);
  const ispe = (width, height) => {
    const box = Buffer.alloc(20);
    box.writeUInt32BE(20, 0);
    box.write("ispe", 4, "ascii");
    box.writeUInt32BE(width, 12);
    box.writeUInt32BE(height, 16);
    return box;
  };
  await writeFile(
    join(dir, "images/multi.avif"),
    Buffer.concat([ftyp, ispe(160, 90), ispe(1920, 1080)]),
  );
  assert.deepEqual(readImageDimensions("images/multi.avif", dir), {
    width: 1920,
    height: 1080,
  });
  await rm(dir, { recursive: true, force: true });
});

test("readImageDimensions returns null for missing file and path escape", () => {
  assert.equal(readImageDimensions("images/nope.png", sampleDir), null);
  assert.equal(readImageDimensions("../escape.png", sampleDir), null);
});

test("readImageOrientation reads PNG eXIf orientation and nulls when absent", () => {
  // Chromium 按 EXIF 旋转显示而尺寸按未旋转像素读取：orientation ≠ 1 的图
  // 会横倒进成片，这里钉住解析口径（Pillow 生成的 orientation=8 fixture）。
  assert.equal(readImageOrientation("images/exif-rotated-8.png", sampleDir), 8);
  assert.equal(readImageOrientation("images/codex-reset.png", sampleDir), null);
  assert.equal(readImageOrientation("images/nope.png", sampleDir), null);
});

test("readImageOrientation reads a JPEG APP1 Exif orientation", async () => {
  const root = await mkdtemp(join(tmpdir(), "image-orientation-jpeg-"));
  const images = join(root, "images");
  await mkdir(images, {recursive: true});
  try {
    const tiff = Buffer.alloc(26);
    tiff.write("II", 0, "ascii");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(274, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(6, 18);
    const app1 = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(app1.length + 2);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      length,
      app1,
      Buffer.from([0xff, 0xd9]),
    ]);
    await writeFile(join(images, "orientation-6.jpg"), jpeg);

    assert.equal(readImageOrientation("images/orientation-6.jpg", root), 6);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
