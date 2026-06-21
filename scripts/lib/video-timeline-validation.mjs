import {readFileSync} from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import {
  videoTimelinePath,
  videoTimelineSchemaPath,
} from "./paths.mjs";

const schema = JSON.parse(readFileSync(videoTimelineSchemaPath, "utf8"));
const validateSchema = new Ajv2020({allErrors: true}).compile(schema);

const formatSchemaError = (error) => {
  const path = error.instancePath.replaceAll("/", ".").replace(/^\./, "") || "$";
  return `${path}: ${error.message}`;
};

// video-timeline.json 是时间线常量（fps / storyTransitionFrames）的单一事实源，
// 渲染侧 TS 与生成/评论侧 JS 同源读取。校验它可在第一时间拦截非法值（如 fps
// 被改成非 30、过渡帧为 0），避免评论与画面错位这类隐蔽 bug 流到渲染阶段。
export function validateVideoTimeline() {
  let timeline;
  try {
    timeline = JSON.parse(readFileSync(videoTimelinePath, "utf8"));
  } catch (error) {
    return {
      errors: [
        error instanceof SyntaxError
          ? `video-timeline.json is invalid JSON: ${error.message}`
          : `Unable to read video-timeline.json: ${error.message}`,
      ],
    };
  }

  return validateVideoTimelineValue(timeline);
}

export function validateVideoTimelineValue(timeline) {
  const errors = validateSchema(timeline)
    ? []
    : validateSchema.errors.map(formatSchemaError);
  return {errors, timeline};
}
