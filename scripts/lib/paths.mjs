import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

export const rootDir = resolve(import.meta.dirname, "../..");
export const dataDir = resolve(rootDir, "data-scheme");
export const rawDataPath = resolve(dataDir, "data.json");
export const generatedDataPath = resolve(dataDir, "data-generate.json");
export const schemaPath = resolve(rootDir, "config", "data.schema.json");
export const videoLayoutPath = resolve(rootDir, "config", "video-layout.json");
export const videoLayoutSchemaPath = resolve(rootDir, "config", "video-layout.schema.json");
export const videoTimelinePath = resolve(rootDir, "config", "video-timeline.json");
export const videoTimelineSchemaPath = resolve(rootDir, "config", "video-timeline.schema.json");

export async function readJson(path, displayPath) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${displayPath} does not exist.`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`${displayPath} is invalid JSON: ${error.message}`);
    }
    throw error;
  }
}
