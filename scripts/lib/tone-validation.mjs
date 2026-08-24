// strict-tone 口吻闸（supplied-source 专用）：`bun run check-data-json --strict-tone`。
// 只在显式 flag 下启用；原生 RSS 与手动流程不带 flag，不受这些规则影响
//（`ingest/prompts.go` 仍允许原生不确定图片证据使用「据截图显示」类措辞）。
//
// 分级原则：
// - 阻断：仅收窄到「证据媒介叙述」模板（描述截图/图片/画面/配图，而不播报新闻事实）。
// - 警告：匿名归因、评价/建议/免责填空——是复核线索，不是语义判决，不阻断。
// - 合法影响表达（可能、意味着、将影响）不在任何清单内，不得误报。

const BLOCKED_MEDIUM_PHRASES = [
  "配图展示",
  "配图显示",
  "配图称",
  "截图标题",
  "截图显示",
  "截图展示",
  "截图称",
  "截图中",
  "图片显示",
  "图片展示",
  "图片称",
  "画面展示",
  "画面显示",
  "图中显示",
  "图中可见",
  "从截图",
  "从图片",
  "从配图",
  "从图中",
  "如图所",
  "这张截图",
  "这张图片",
  "这张配图",
  "上图显示",
  "下图显示",
  "上图展示",
  "下图展示",
  "请看截图",
  "请看图片",
  "请看配图",
  "请看画面",
  "据截图",
  "据配图",
  "据图片",
];

const ANONYMOUS_ATTRIBUTION_PHRASES = [
  "消息称",
  "消息指",
  "据消息",
  "知情人士",
  "更新说明称",
];

const EDITORIAL_FILLER_PHRASES = [
  "应等待",
  "应留意",
  "避免把",
  "这不代表",
  "不能等同于",
  "较为罕见",
];

// 「建议」裸 includes 会误伤「不建议」「建议者」这类否定/名词化用法；作为警告级
// 线索，只匹配独立语义的「建议」（无否定前缀、非「建议者」）。
const EDITORIAL_ADVICE_WORD = /(?<![不好别莫无])建议(?!者)/;

// 「官方表示」只有自身充当分句主语（前面没有点名主体）时才算匿名归因；
// 「DeepSeek 官方表示」「阿里官方表示」有明确主体，不警告。
const CLAUSE_START_OFFICIAL = /(?:^|[，。！？；：、])官方(?:表示|称|回应)/;

// 「如果……将……」式假设推演是填空线索；句内跨度收窄到 24 字避免跨句误配。
const HYPOTHETICAL_FILLER = /如果.{1,24}将/;

function storyTextFields(story, storyPath) {
  return [
    { path: `${storyPath}.contentTitle`, text: story.contentTitle },
    { path: `${storyPath}.introTitle`, text: story.introTitle },
    ...(story.tabs ?? []).flatMap((tab, index) => [
      { path: `${storyPath}.tabs[${index}].title`, text: tab.title },
      { path: `${storyPath}.tabs[${index}].summary`, text: tab.summary },
    ]),
    ...(story.scenes ?? []).map((scene, index) => ({
      path: `${storyPath}.scenes[${index}].subtitle`,
      text: scene.subtitle,
    })),
  ];
}

export function validateTone(report) {
  const errors = [];
  const warnings = [];
  const entries = [
    ...(report.intro ? [{ story: report.intro, path: "intro" }] : []),
    ...(report.stories ?? []).map((story, index) => ({
      story,
      path: `stories[${index}]`,
    })),
    ...(report.outro ? [{ story: report.outro, path: "outro" }] : []),
  ];

  for (const { story, path } of entries) {
    for (const field of storyTextFields(story, path)) {
      const text = field.text;
      if (typeof text !== "string" || text.length === 0) continue;

      for (const phrase of BLOCKED_MEDIUM_PHRASES) {
        if (text.includes(phrase)) {
          // 每个字段只报第一条媒介错误，同一句多个模板不重复刷屏。
          errors.push(
            `${field.path}: narrates the evidence medium ("${phrase}"); state the sourced fact directly without describing the image`,
          );
          break;
        }
      }
      for (const phrase of ANONYMOUS_ATTRIBUTION_PHRASES) {
        if (text.includes(phrase)) {
          warnings.push(
            `${field.path}: anonymous attribution ("${phrase}"); name the real subject (e.g. "DeepSeek 通知" / "彭博社报道")`,
          );
        }
      }
      if (CLAUSE_START_OFFICIAL.test(text)) {
        warnings.push(
          `${field.path}: "官方" as clause subject is anonymous attribution; name the actual publisher`,
        );
      }
      for (const phrase of EDITORIAL_FILLER_PHRASES) {
        if (text.includes(phrase)) {
          warnings.push(
            `${field.path}: possible editorial filler ("${phrase}"); keep to facts the source actually states`,
          );
        }
      }
      if (EDITORIAL_ADVICE_WORD.test(text)) {
        warnings.push(
          `${field.path}: possible editorial filler ("建议"); keep to facts the source actually states`,
        );
      }
      if (HYPOTHETICAL_FILLER.test(text)) {
        warnings.push(
          `${field.path}: possible hypothetical filler ("如果…将…"); only keep impact statements the source actually states`,
        );
      }
    }
  }
  return { errors, warnings };
}
