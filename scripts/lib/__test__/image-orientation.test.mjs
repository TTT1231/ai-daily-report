import {test} from "bun:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {stripExifOrientation} from "../image-orientation.mjs";

const rotatedPng = resolve(
  import.meta.dirname,
  "../../../test/mock/images/exif-rotated-8.png",
);

test("stripExifOrientation removes a PNG eXIf chunk without changing pixel chunks", () => {
  const source = readFileSync(rotatedPng);
  const result = stripExifOrientation(source);
  assert.equal(result.removed, true);
  assert.equal(result.buffer.includes(Buffer.from("eXIf", "ascii")), false);
  assert.equal(result.buffer.subarray(0, 8).equals(source.subarray(0, 8)), true);
  assert.equal(result.buffer.includes(Buffer.from("IDAT", "ascii")), true);
});

test("stripExifOrientation leaves a PNG without EXIF byte-identical", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../../test/mock/images/codex-reset.png"),
  );
  const result = stripExifOrientation(source);
  assert.equal(result.removed, false);
  assert.equal(result.buffer.equals(source), true);
});

test("stripExifOrientation removes a JPEG APP1 Exif segment", () => {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(274, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(8, 18);
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(app1.length + 2);
  const source = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    length,
    app1,
    Buffer.from([0xff, 0xd9]),
  ]);

  const result = stripExifOrientation(source);
  assert.equal(result.removed, true);
  assert.deepEqual(result.buffer, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});
