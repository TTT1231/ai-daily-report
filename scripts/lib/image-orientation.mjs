function isPng(buffer) {
  return buffer.length >= 8 && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a";
}

function isJpeg(buffer) {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function stripPngExif(buffer) {
  const chunks = [buffer.subarray(0, 8)];
  let removed = false;
  for (let offset = 8; offset + 12 <= buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error("PNG contains a truncated chunk");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "eXIf") {
      removed = true;
    } else {
      chunks.push(buffer.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") break;
  }
  return {buffer: Buffer.concat(chunks), removed};
}

function stripJpegExif(buffer) {
  const parts = [buffer.subarray(0, 2)];
  let removed = false;
  let offset = 2;
  while (offset < buffer.length) {
    const markerStart = offset;
    if (buffer[offset] !== 0xff) {
      parts.push(buffer.subarray(offset));
      break;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++];
    if (marker === 0xd9) {
      parts.push(buffer.subarray(markerStart, offset));
      break;
    }
    if (marker === 0xda) {
      parts.push(buffer.subarray(markerStart));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buffer.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > buffer.length) throw new Error("JPEG contains a truncated segment");
    const segmentLength = buffer.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length) {
      throw new Error("JPEG contains an invalid segment length");
    }
    const exif =
      marker === 0xe1 &&
      buffer.subarray(offset + 2, offset + 8).equals(Buffer.from("Exif\0\0", "binary"));
    if (exif) {
      removed = true;
    } else {
      parts.push(buffer.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }
  return {buffer: Buffer.concat(parts), removed};
}

export function stripExifOrientation(buffer) {
  if (isPng(buffer)) return stripPngExif(buffer);
  if (isJpeg(buffer)) return stripJpegExif(buffer);
  throw new Error("Only PNG and JPEG EXIF orientation normalization is supported");
}
