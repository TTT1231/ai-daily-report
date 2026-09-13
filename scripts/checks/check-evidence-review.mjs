import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {
  sha256File,
  sha256Text,
  validateEvidenceReview,
} from "../lib/evidence-review.mjs";

function option(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const requestedManifest = option("manifest");
if (!requestedManifest) {
  console.error(
    "Missing --manifest=<path> from the latest evidence:frames run.",
  );
  process.exit(1);
}

const manifestPath = resolve(requestedManifest);
const reviewPath = resolve(
  option("review") ?? join(dirname(manifestPath), "review.json"),
);

function readJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  try {
    return {text: readFileSync(path, "utf8")};
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

function parseJson(document, label) {
  try {
    return JSON.parse(document.text);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

let manifestDocument;
let reviewDocument;
let manifest;
let review;
try {
  manifestDocument = readJson(manifestPath, "evidence frame manifest");
  reviewDocument = readJson(reviewPath, "evidence visual review");
  manifest = parseJson(manifestDocument, "evidence frame manifest");
  review = parseJson(reviewDocument, "evidence visual review");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const fingerprintErrors = [];
const fingerprint = (path, label) => {
  if (typeof path !== "string" || !existsSync(path)) {
    fingerprintErrors.push(`${label} does not exist: ${path ?? "(missing path)"}`);
    return null;
  }
  return sha256File(path);
};

const currentFrameSha256ByFileName = new Map();
for (const frame of manifest.frames ?? []) {
  currentFrameSha256ByFileName.set(
    frame.fileName,
    fingerprint(frame.outputPath, `frame ${frame.fileName}`),
  );
}

const result = validateEvidenceReview({
  manifest,
  manifestSha256: sha256Text(manifestDocument.text),
  review,
  currentVideoSha256: fingerprint(manifest.video?.path, "rendered video"),
  currentGeneratedDataSha256: fingerprint(
    manifest.generatedData?.path,
    "generated data",
  ),
  currentFrameSha256ByFileName,
});
const errors = [...fingerprintErrors, ...result.errors];

if (errors.length > 0) {
  console.error(
    `Evidence visual review failed with ${errors.length} error(s):`,
  );
  errors.forEach((error) => console.error(`- ${error}`));
  console.error(
    "Fix every failed frame, rerender, run evidence:frames again, and review the fresh pending checklist.",
  );
  process.exit(1);
}

console.log(
  `Evidence visual review passed: ${result.passedFrames}/${result.totalFrames} fresh rendered frame(s) explicitly approved.`,
);
