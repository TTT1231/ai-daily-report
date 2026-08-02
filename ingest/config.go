package main

import "time"

// 本文件集中存放 RSS 日报生成流程使用的默认值、阈值与上限。
// 这些常量不对应外部可配置项，
// 而是控制抓取窗口、AI 输出规模与视频文案长度的内部调参点。
const (
	rssLookback               = 24 * time.Hour             // 固定抓取最近 24 小时内的内容。
	rssStateRelativePath      = "ingest/rss-state.json"    // 固定保存最近一次抓取快照的位置。
	picksRelativePath         = "ingest/picks.json"        // 固定保存人工 pick 的白名单（{hash: true}）。
	defaultSourcesPath        = "ingest/sources.jsonc"     // 默认 RSS 来源配置。
	defaultPreferencesPath    = "ingest/preferences.jsonc" // 默认用户兴趣画像配置。
	defaultRequestTimeout     = 200 * time.Second          // 调用 AI 模型 chat/completions 接口的默认超时。
	defaultFeedRequestTimeout = 20 * time.Second           // 抓取 RSS 2.0 源的默认 HTTP 超时。
	maxGroups                 = 15                         // 聚类后最多保留的 Story（视频主题）数量上限。
	maxGroupHighlights        = 6                          // 每个 Story 最多保留的不重复要点数，对应视频的 tab 数。
	storyTabBatchSize         = 4                          // 生成 Tabs 时每批送入模型的 Story 数量。
	maxStoryTabSources        = 4                          // 单个 Story 最多引用的代表来源数量。
	minStoryTabs              = 2                          // 每个 Story 至少需要的 Tab 数量，低于此值触发模型定向重写。
	maxStoryTabs              = 6                          // 每个 Story 最多允许的 Tab 数量。
	minTabSummaryRunes        = 25                         // Tab 摘要（summary）的最小汉字长度，过短视为无效。
	maxTabSummaryVisibleRunes = 110                        // Tab 摘要的纯文本上限；Markdown 视觉占用另行带权校验。
	minSceneSubtitleRunes     = 28                         // 场景口播字幕（subtitle）的最小汉字长度。
	maxSceneSubtitleRunes     = 96                         // 场景口播字幕（subtitle）的最大汉字长度。
	maxSourceTextRunes        = 5000                       // 送给模型时单条来源正文的最大字符数，超出截断。
	maxContentTitleRunes      = 30                         // 内容主标题（contentTitle）的画面安全上限；超长必须语义改写，禁止截断。
	maxNavigationTitleUnits   = 5.0                        // 底部短标签视觉宽度上限；中文约 5 字，ASCII 按 0.62 计。
)
