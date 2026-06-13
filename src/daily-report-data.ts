import {z} from "zod";
import reportJson from "../data-scheme/data-generate.json";

const dailyTabSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  icon: z.string().min(1).optional(),
});

const dailySceneSchema = z.object({
  id: z.string().min(1),
  subtitle: z.string().min(1).max(96),
  audioSrc: z.string().min(1).optional(),
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
  overlayImg: z.string().min(1).optional(),
});

const dailyStorySchema = z
  .object({
    id: z.string().min(1),
    topTitle: z.string().min(3).max(5),
    bottomTitle: z.string().min(3).max(5),
    contentTitle: z.string().min(1).max(42),
    introTitle: z.string().min(1).optional(),
    activeTab: z.string().min(1).optional(),
    activeIntro: z.literal(true).optional(),
    tabs: z.array(dailyTabSchema).min(1).max(6),
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

const dailyOutroSchema = z.object({
  id: z.literal("outro"),
  topTitle: z.string().min(1),
  bottomTitle: z.string().min(1),
  scenes: z.array(dailySceneSchema).length(1),
});

const dailyIntroSchema = z.object({
  id: z.literal("intro"),
  topTitle: z.string().min(1),
  bottomTitle: z.string().min(1),
  contentTitle: z.string().min(1),
  activeTab: z.string().min(1).optional(),
  tabs: z.array(dailyTabSchema).min(1),
  scenes: z.array(dailySceneSchema).length(1),
});

const dailyReportSchema = z
  .object({
    theme: z.enum(["light", "dark"]).default("light"),
    date: z.string().min(1),
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
  });

export type DailyTab = z.infer<typeof dailyTabSchema>;
export type DailyScene = z.infer<typeof dailySceneSchema>;
export type DailyStory = z.infer<typeof dailyStorySchema>;
export type DailyIntro = z.infer<typeof dailyIntroSchema>;
export type DailyOutro = z.infer<typeof dailyOutroSchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;

export const dailyReport: DailyReport = dailyReportSchema.parse(reportJson);
