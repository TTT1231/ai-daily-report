import {readFileSync} from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import {
  videoLayoutPath,
  videoLayoutSchemaPath,
} from "./paths.mjs";

// schema 文件缺失/损坏时不让模块加载抛裸堆栈：延迟到校验入口报一条可读错误
// （退出码仍非零，只是输出对用户友好）。
let schemaLoadError = null;
let validateSchema = () => true;
try {
  validateSchema = new Ajv2020({allErrors: true}).compile(
    JSON.parse(readFileSync(videoLayoutSchemaPath, "utf8")),
  );
} catch (error) {
  schemaLoadError = `Unable to load video-layout.schema.json: ${error.message}`;
}

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
  if (schemaLoadError) return {errors: [schemaLoadError]};
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
