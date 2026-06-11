import {z} from "zod";
import reportJson from "../data-scheme/data-generate.json";

const dailyTabSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
});

const dailySceneSchema = z.object({
  id: z.string().min(1),
  activeTab: z.string().min(1),
  subtitle: z.string().min(1),
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
  overlay: z
    .object({
      src: z.string().min(1),
      caption: z.string().min(1),
    })
    .optional(),
});

const dailyStorySchema = z
  .object({
    id: z.string().min(1),
    topTitle: z.string().min(1),
    bottomTitle: z.string().min(1),
    contentTitle: z.string().min(1),
    tabs: z.array(dailyTabSchema).min(1).max(6),
    scenes: z.array(dailySceneSchema).min(1),
  })
  .superRefine((story, context) => {
    const tabIds = new Set(story.tabs.map((tab) => tab.id));
    story.scenes.forEach((scene, sceneIndex) => {
      if (!tabIds.has(scene.activeTab)) {
        context.addIssue({
          code: "custom",
          path: ["scenes", sceneIndex, "activeTab"],
          message: `activeTab "${scene.activeTab}" does not exist in story tabs`,
        });
      }
    });
  });

const dailyReportSchema = z.object({
  schemaVersion: z.literal(1),
  date: z.string().min(1),
  label: z.string().min(1),
  stories: z.array(dailyStorySchema).min(1),
});

export type DailyTab = z.infer<typeof dailyTabSchema>;
export type DailyScene = z.infer<typeof dailySceneSchema>;
export type DailyStory = z.infer<typeof dailyStorySchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;

export const dailyReport: DailyReport = dailyReportSchema.parse(reportJson);
