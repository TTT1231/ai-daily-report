import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

export const rootDir = resolve(import.meta.dirname, "../..");
export const dataDir = resolve(rootDir, "data-scheme");
export const rawDataPath = resolve(dataDir, "data.json");
export const generatedDataPath = resolve(dataDir, "data-generate.json");
export const schemaPath = resolve(rootDir, "data.schema.json");
export const videoLayoutPath = resolve(rootDir, "video-layout.json");
export const videoLayoutSchemaPath = resolve(rootDir, "video-layout.schema.json");

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
