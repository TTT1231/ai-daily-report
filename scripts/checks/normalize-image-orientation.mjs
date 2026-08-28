import {copyFileSync, existsSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {extname, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {stripExifOrientation} from "../lib/image-orientation.mjs";

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const inputArg = positional[0];
const outputOption = process.argv.find((arg) => arg.startsWith("--output="));
const pixelsUpright = process.argv.includes("--pixels-upright");
const ffmpegOption = process.argv.find((arg) => arg.startsWith("--ffmpeg="));

if (!inputArg) {
  console.error(
    "Usage: bun run image:normalize-orientation -- <image.png|image.jpg> [--pixels-upright] [--output=<path>]",
  );
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputOption ? outputOption.slice("--output=".length) : inputPath);
const ffmpeg = ffmpegOption ? ffmpegOption.slice("--ffmpeg=".length) : "ffmpeg";
if (!existsSync(inputPath)) {
  console.error(`Image does not exist: ${inputPath}`);
  process.exit(1);
}
if (!/\.(?:png|jpe?g)$/i.test(inputPath)) {
  console.error("Orientation normalization currently supports PNG and JPEG only.");
  process.exit(1);
}

const workPath = `${outputPath}.orientation-${process.pid}${extname(outputPath)}`;
try {
  if (pixelsUpright) {
    copyFileSync(inputPath, workPath);
  } else {
    const result = spawnSync(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-i", inputPath, "-map_metadata", "-1", "-y", workPath],
      {encoding: "utf8"},
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `ffmpeg exited ${result.status}`);
    }
  }

  const stripped = stripExifOrientation(readFileSync(workPath));
  writeFileSync(workPath, stripped.buffer);
  copyFileSync(workPath, outputPath);
  console.log(
    `Normalized image orientation: ${outputPath}${pixelsUpright ? " (pixels kept upright; EXIF removed)" : " (EXIF rotation baked; EXIF removed)"}`,
  );
} catch (error) {
  console.error(`Image orientation normalization failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(workPath, {force: true});
}
