package main

import "time"

// 本文件集中存放 RSS 日报生成流程使用的默认值、阈值与上限。
// 这些常量不对应外部可配置项，
// 而是控制抓取窗口、AI 输出规模与视频文案长度的内部调参点。
const (
	defaultAIBaseURL          = "https://api.deepseek.com" // 默认 AI 服务地址（DeepSeek 官方 OpenAI 兼容接口）。
	defaultAIModel            = "deepseek-v4-flash"        // 默认模型名，未设置 AI_MODEL 时生效。
	rssLookback               = 24 * time.Hour             // 固定抓取最近 24 小时内的内容。
	rssStateRelativePath      = "rss/rss-state.json"       // 固定保存上一次抓取快照的位置。
	defaultRequestTimeout     = 90 * time.Second           // 调用 AI 模型 chat/completions 接口的默认超时。
	defaultFeedRequestTimeout = 20 * time.Second           // 抓取 RSS 2.0 源的默认 HTTP 超时。
	maxCandidates             = 30                         // 评分阶段最多保留的候选数量上限。
	maxGroups                 = 15                         // 聚类后最多保留的 Story（视频主题）数量上限。
	maxGroupHighlights        = 6                          // 每个 Story 最多保留的不重复要点数，对应视频的 tab 数。
	storyTabBatchSize         = 4                          // 生成 Tabs 时每批送入模型的 Story 数量。
	maxStoryTabSources        = 4                          // 单个 Story 最多引用的代表来源数量。
	minStoryTabs              = 2                          // 每个 Story 至少需要的 Tab 数量，低于此值走保底补齐。
	maxStoryTabs              = 6                          // 每个 Story 最多允许的 Tab 数量。
	minTabSummaryRunes        = 20                         // Tab 摘要（summary）的最小汉字长度，过短视为无效。
	minSceneSubtitleRunes     = 28                         // 场景口播字幕（subtitle）的最小汉字长度。
	maxSceneSubtitleRunes     = 96                         // 场景口播字幕（subtitle）的最大汉字长度。
	maxStoryTabRetries        = 2                          // 单个 Story 的 Tabs 校验失败后，带反馈重试的最大次数。
	maxSourceTextRunes        = 5000                       // 送给模型时单条来源正文的最大字符数，超出截断。
	maxTopBottomSegmentGap    = 2                          // 排除 Intro/Outro 后，底部 Story 数与顶部相邻栏目分段数的最大差值。
	maxContentTitleRunes      = 42                         // 内容主标题（contentTitle）的最大字符长度。
	minInterestingScore       = 7                          // 内容入选的最小分数（满分 10），低于此分直接丢弃。
)
