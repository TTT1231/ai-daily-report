import {validateNewsCopy} from "./news-copy.mjs";

// strict-tone 口吻闸（supplied-source 专用）：`bun run check-data-json --strict-tone`。
// 此处的媒介检查只在显式 flag 下启用；明确转述模板由 Raw 通用校验一起拒收。
// 各生成入口仍应遵循同一成品新闻写法；此处只检测常见句式，不替代语义审稿。
//
// 分级原则：
// - 阻断：明确的证据媒介/查证叙述模板，覆盖口播与卡片摘要。
// - 警告：需看语境的榜单报分、账号归因、匿名归因、评价/建议/免责填空。
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

// 口播和摘要都是成品文案，出处/核验过程留在事实台账中。
// 不禁止“某媒体报道”“据某机构监测”或文档/榜单/账号本身发生变更的新闻。
const SOURCE_PROSE_PATTERNS = [
  /(?:支持页|帮助页|产品页|活动页|官方页面|页面|网页|文档)(?:中)?(?:说明|显示|列出|标注|标明|标出|写明|注明|提示|提醒)/u,
  /(?:页面|网页)标注(?:的)?发布日期/u,
  /(?:存档|快照)中(?:出现|记录到|显示)/u,
  /(?:存档|快照)(?:也)?记录到/u,
  /当前可核实证据|证据只确认/u,
  /(?:图表|基准图|性能图|成绩图|评测图)(?:在[^，。！？；：]{1,20})?(?:显示|表明|标注|记下|记录)/u,
  /(?:图表|基准图|性能图|成绩图|评测图)(?:中|上|里)(?:[，,：:]|\s*[^，。！？；：]{1,40}(?:得分|得|为|达到)\s*\d+(?:\.\d+)?)/u,
  /(?:帖子|贴文|推文)(?:中)?(?:给出|写明|注明|标注|标明|提到)/u,
  /(?:帖子|贴文|推文)把[^，。！？；：]{1,30}标为/u,
  /测试标注(?:为)?\s*(?:Tool\s*off|N\s*[=＝])/iu,
];

// 账号发言可能就是事件，榜单也可能确实在讲排名；提示人工判断，不一刀切阻断。
const SOURCE_PROSE_REVIEW_PATTERNS = [
  /官方(?:账号|帐号)(?:发文)?(?:称|表示|宣布|透露)/u,
  /榜单(?:中|上|里)[^。！？；]{0,60}?(?:得分|得|为|是)\s*\d+(?:\.\d+)?\s*[%％]/u,
];

// Review audit-style appendices without banning real uncertainty, denials or
// source attribution. A hit requests a rewrite judgement, never an auto-delete.
const AUDIT_APPENDIX_PATTERNS = [
  /这(?:并)?不是(?:彻底|永久|完全)解决(?:的)?保证/u,
  /这是[^，。！？；]{1,24}(?:判断|观点|主张)[，,](?:而非|并非|不是)/u,
  /这是[^。！？；]{1,24}(?:观点|主张)而非[^。！？；]{1,16}(?:定论|结论)/u,
];

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const arrayOrEmpty = (value) => (Array.isArray(value) ? value : []);

function storyTextFields(story, storyPath) {
  return [
    { path: `${storyPath}.contentTitle`, text: story.contentTitle },
    { path: `${storyPath}.introTitle`, text: story.introTitle },
    ...arrayOrEmpty(story.tabs).flatMap((tab, index) =>
      isRecord(tab)
        ? [
            { path: `${storyPath}.tabs[${index}].title`, text: tab.title },
            { path: `${storyPath}.tabs[${index}].summary`, text: tab.summary },
          ]
        : [],
    ),
    ...arrayOrEmpty(story.scenes).flatMap((scene, index) =>
      isRecord(scene)
        ? [
            {
              path: `${storyPath}.scenes[${index}].subtitle`,
              text: scene.subtitle,
            },
          ]
        : [],
    ),
  ];
}

export function validateTone(report) {
  const errors = validateNewsCopy(report);
  const warnings = [];
  if (!isRecord(report)) return { errors, warnings };
  const entries = [
    ...(report.intro ? [{ story: report.intro, path: "intro" }] : []),
    ...arrayOrEmpty(report.stories).map((story, index) => ({
      story,
      path: `stories[${index}]`,
    })),
    ...(report.outro ? [{ story: report.outro, path: "outro" }] : []),
  ];

  for (const { story, path } of entries) {
    if (!isRecord(story)) continue;
    for (const field of storyTextFields(story, path)) {
      const text = field.text;
      if (typeof text !== "string" || text.length === 0) continue;

      // 摘要可以有 Markdown；格式不能把同一来源句式藏在不同片段中。
      const plainText = text.replace(/\*\*|`/gu, "");
      const isCopy =
        field.path.endsWith(".subtitle") || field.path.endsWith(".summary");
      const audit = isCopy
        ? SOURCE_PROSE_PATTERNS.find((pattern) => pattern.test(plainText))
        : undefined;
      const medium = BLOCKED_MEDIUM_PHRASES.find((phrase) =>
        plainText.includes(phrase),
      );
      if (audit || medium) {
        const phrase = audit ? plainText.match(audit)[0] : medium;
        // 同一字段只报一次来源叙述，要求重写事实关系，不能自动删词丢掉限定。
        errors.push(
          `${field.path}: ${audit ? "narrates the source instead of the news" : "narrates the evidence medium"} ("${phrase}"); explain the event or evaluation directly, preserving only necessary attribution, dates and factual limits`,
        );
      }
      if (isCopy) {
        const review = SOURCE_PROSE_REVIEW_PATTERNS.find((pattern) =>
          pattern.test(plainText),
        );
        if (review) {
          warnings.push(
            `${field.path}: possible source-led copy ("${plainText.match(review)[0]}"); review whether this is an event, evaluation or ranking; preserve accountable attribution and do not imply availability from a listing`,
          );
        }
        const appendix = AUDIT_APPENDIX_PATTERNS.find((pattern) => pattern.test(plainText));
        if (appendix) {
          warnings.push(`${field.path}: audit-style appendix ("${plainText.match(appendix)[0]}"); integrate attribution and necessary conditions into the event, then review the complete narration`);
        }
      }

      if (field.path.endsWith(".subtitle")) {
        if (/`|\*\*|\[[^\]]+\]\(/u.test(text)) {
          errors.push(`${field.path}: narration contains Markdown; write plain spoken text`);
        }
        if (/合资格|不能据此断定|数据不说明单一原因/u.test(text)) {
          warnings.push(`${field.path}: unnatural narration or audit filler; use natural Mandarin and integrate necessary factual limits into the news`);
        }
      }

      for (const phrase of ANONYMOUS_ATTRIBUTION_PHRASES) {
        if (text.includes(phrase)) {
          warnings.push(
            `${field.path}: anonymous attribution ("${phrase}"); use the actual actor and action; name a source only when it changes the claim's factual status`,
          );
        }
      }
      if (CLAUSE_START_OFFICIAL.test(text)) {
        warnings.push(
          `${field.path}: "官方" as clause subject is anonymous attribution; state the product action or rule directly, naming a publisher only when necessary`,
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
