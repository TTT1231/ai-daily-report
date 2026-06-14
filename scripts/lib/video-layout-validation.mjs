import {readFileSync} from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import {
  videoLayoutPath,
  videoLayoutSchemaPath,
} from "./paths.mjs";

const schema = JSON.parse(readFileSync(videoLayoutSchemaPath, "utf8"));
const validateSchema = new Ajv2020({allErrors: true}).compile(schema);

const formatSchemaError = (error) => {
  const path = error.instancePath.replaceAll("/", ".").replace(/^\./, "") || "$";
  return `${path}: ${error.message}`;
};

export function validateVideoLayout() {
  let layout;
  try {
    layout = JSON.parse(readFileSync(videoLayoutPath, "utf8"));
  } catch (error) {
    return {
      errors: [
        error instanceof SyntaxError
          ? `video-layout.json is invalid JSON: ${error.message}`
          : `Unable to read video-layout.json: ${error.message}`,
      ],
    };
  }

  return validateVideoLayoutValue(layout);
}

export function validateVideoLayoutValue(layout) {
  const errors = validateSchema(layout)
    ? []
    : validateSchema.errors.map(formatSchemaError);
  if (errors.length > 0) return {errors, layout};

  const layouts = layout.navigation.layouts;
  for (let index = 1; index < layouts.length; index++) {
    if (layouts[index - 1].minItems <= layouts[index].minItems) {
      errors.push(
        `navigation.layouts[${index}].minItems: must be lower than the previous layout threshold`,
      );
    }
  }
  if (layouts.at(-1).minItems !== 0) {
    errors.push("navigation.layouts: final layout must use minItems: 0 as a fallback");
  }

  return {errors, layout};
}
