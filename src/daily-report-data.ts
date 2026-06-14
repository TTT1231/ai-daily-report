import {z} from "zod";
import reportJson from "../data-scheme/data-generate.json";
import {
  mergeAdjacentNavigationLabels,
  navigationAvailableWidth,
  navigationRequiredWidth,
} from "./navigation-layout";

// 本 Zod schema 校验的是 Generated 数据契约（data-generate.json，Remotion 唯一读取的文件）。
// 字段约束与 data.schema.json 对齐；Raw 数据（data.json）请用 bun run check-data-json 校验。
// 下方 identifier/date/path 等基础约束与 JSON Schema 的 $defs 复用同一套规则。

export const identifierSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-.]*$/, "identifier must match ^[a-z0-9][a-z0-9-.]*$");
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
export const imagePathSchema = z
  .string()
  .min(1)
  .regex(
    /^images\/.+\.(svg|png|jpe?g|webp)$/,
    "image path must be images/<name>.<ext>",
  );
export const audioPathSchema = z
  .string()
  .min(1)
  .regex(
    /^audio\/.+\.(mp3|wav|m4a|aac|ogg)$/,
    "audio path must be audio/<name>.<ext>",
  );
export const iconPathSchema = z
  .string()
  .min(1)
  .regex(/^icons\/.+\.(svg|png)$/, "icon path must be icons/<name>.<ext>");

export const dailyTabSchema = z.object({
  id: identifierSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  icon: iconPathSchema.optional(),
});

export const dailySceneSchema = z.object({
  id: identifierSchema,
  subtitle: z.string().min(1).max(96),
  audioSrc: audioPathSchema.optional(),
  tts: z
    .object({
      provider: z.literal("minimax"),
      hash: z.string().length(64),
      model: z.string().min(1),
      voiceId: z.string().min(1),
      speed: z.number().min(0.5).max(2),
      vol: z.number().positive().max(10),
      pitch: z.number().min(-12).max(12),
      audioLengthMs: z.number().int().positive(),
      tailPaddingMs: z.number().int().nonnegative(),
    })
    .optional(),
  timing: z.object({
    startMs: z.number().nonnegative(),
    durationMs: z.number().positive(),
  }),
  overlayImg: imagePathSchema.optional(),
});

export const dailyStorySchema = z
  .object({
    id: identifierSchema,
    topTitle: z.string().min(1),
    bottomTitle: z.string().min(1),
    contentTitle: z.string().min(1).max(42),
    introTitle: z.string().min(1).optional(),
    activeTab: identifierSchema.optional(),
    activeIntro: z.literal(true).optional(),
    tabs: z.array(dailyTabSchema).min(2).max(6),
    scenes: z.array(dailySceneSchema).min(1),
  })
  .superRefine((story, context) => {
    const tabIds = new Set(story.tabs.map((tab) => tab.id));
    if (story.activeTab !== undefined && !tabIds.has(story.activeTab)) {
      context.addIssue({
        code: "custom",
        path: ["activeTab"],
        message: `activeTab "${story.activeTab}" does not exist in story tabs`,
      });
    }
  });

export const dailyOutroSchema = z.object({
  id: z.literal("outro"),
  topTitle: z.string().min(1),
  bottomTitle: z.string().min(1),
  scenes: z.array(dailySceneSchema).length(1),
});

export const dailyIntroSchema = z.object({
  id: z.literal("intro"),
  topTitle: z.string().min(1),
  bottomTitle: z.string().min(1),
  contentTitle: z.string().min(1),
  activeTab: identifierSchema.optional(),
  tabs: z.array(dailyTabSchema).min(2),
  scenes: z.array(dailySceneSchema).length(1),
});

export const dailyReportSchema = z
  .object({
    theme: z.enum(["light", "dark"]).default("light"),
    date: dateSchema,
    intro: dailyIntroSchema,
    stories: z.array(dailyStorySchema).min(1),
    outro: dailyOutroSchema,
  })
  .superRefine((report, context) => {
    if (report.stories.filter((story) => story.activeIntro === true).length > 1) {
      context.addIssue({
        code: "custom",
        path: ["stories"],
        message: "Only one story may set activeIntro to true",
      });
    }
    const timeline = [report.intro, ...report.stories, report.outro];
    const navigations = {
      bottom: timeline.map(({bottomTitle}) => bottomTitle),
      top: mergeAdjacentNavigationLabels(
        timeline.map(({topTitle}) => topTitle),
      ),
    };
    for (const [name, labels] of Object.entries(navigations)) {
      const requiredWidth = navigationRequiredWidth(labels);
      if (requiredWidth > navigationAvailableWidth) {
        context.addIssue({
          code: "custom",
          path: ["stories"],
          message: `${name} navigation requires ${requiredWidth}px but only ${navigationAvailableWidth}px is available`,
        });
      }
    }
  });

export type DailyTab = z.infer<typeof dailyTabSchema>;
export type DailyScene = z.infer<typeof dailySceneSchema>;
export type DailyStory = z.infer<typeof dailyStorySchema>;
export type DailyIntro = z.infer<typeof dailyIntroSchema>;
export type DailyOutro = z.infer<typeof dailyOutroSchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;

export const dailyReport: DailyReport = dailyReportSchema.parse(reportJson);
