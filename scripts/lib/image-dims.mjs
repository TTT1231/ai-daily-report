import {existsSync, readFileSync} from "node:fs";
import {resolve, sep} from "node:path";

// 从 report-validation.mjs 抽出的图片尺寸读取能力，供 report-builder（构建期写尺寸）共用。
// readImageDimensions 接收 dataDir 参数（与 collectMissingImageAssets 同约定），便于测试隔离。

function readUint24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    return null;
  }
  return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const chunk = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) return null;

    if (chunk === "VP8X" && size >= 10) {
      return {
        width: 1 + readUint24LE(buffer, start + 4),
        height: 1 + readUint24LE(buffer, start + 7),
      };
    }
    if (
      chunk === "VP8 " &&
      size >= 10 &&
      buffer[start + 3] === 0x9d &&
      buffer[start + 4] === 0x01 &&
      buffer[start + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(start + 6) & 0x3fff,
        height: buffer.readUInt16LE(start + 8) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && size >= 5 && buffer[start] === 0x2f) {
      return {
        width: 1 + buffer[start + 1] + ((buffer[start + 2] & 0x3f) << 8),
        height:
          1 +
          (buffer[start + 2] >> 6) +
          (buffer[start + 3] << 2) +
          ((buffer[start + 4] & 0x0f) << 10),
      };
    }

    offset = end;
    if (offset % 2 === 1) offset++;
  }

  return null;
}

// readGifDimensions 解析 GIF87a/GIF89a 的逻辑屏幕描述符：宽高为偏移 6/8 处的小端 uint16。
function readGifDimensions(buffer) {
  if (buffer.length < 10) return null;
  const signature = buffer.toString("ascii", 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  return {width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8)};
}

// readAvifDimensions 解析 AVIF/HEIF（ISO BMFF）的画面尺寸：宽高存在 ispe
// (ImageSpatialExtentsProperty) FullBox 里，布局为
// [4 size][4 "ispe"][4 版本/标志][4 width 大端][4 height 大端]。这里定位首个 ispe 读取；
// 对单图 AVIF（overlay 常见形态）可靠，极少数"缩略图属性排在主图之前"的多图 AVIF 可能读到缩略图尺寸。
function readAvifDimensions(buffer) {
  if (buffer.length < 16) return null;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return null;
  const index = buffer.indexOf(Buffer.from("ispe", "ascii"), 8);
  if (index < 0 || index + 16 > buffer.length) return null;
  const width = buffer.readUInt32BE(index + 8);
  const height = buffer.readUInt32BE(index + 12);
  if (width <= 0 || height <= 0) return null;
  return {width, height};
}

function numberAttribute(svg, name) {
  const match = svg.match(new RegExp(`\\s${name}=["']([0-9.]+)(?:px)?["']`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readSvgDimensions(buffer) {
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
  if (!/<svg[\s>]/i.test(head)) return null;

  const width = numberAttribute(head, "width");
  const height = numberAttribute(head, "height");
  if (width && height) return {width, height};

  const viewBox = head.match(/\sviewBox=["']([0-9.\s-]+)["']/i);
  if (!viewBox) return null;
  const values = viewBox[1].trim().split(/\s+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return values[2] > 0 && values[3] > 0
    ? {width: values[2], height: values[3]}
    : null;
}

export function readImageDimensions(assetPath, dataDir) {
  const absolute = resolve(dataDir, assetPath);
  if (!absolute.startsWith(dataDir + sep) || !existsSync(absolute)) return null;
  const buffer = readFileSync(absolute);
  return (
    readPngDimensions(buffer) ??
    readJpegDimensions(buffer) ??
    readWebpDimensions(buffer) ??
    readGifDimensions(buffer) ??
    readAvifDimensions(buffer) ??
    readSvgDimensions(buffer)
  );
}
