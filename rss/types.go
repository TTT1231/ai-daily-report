package main

import "time"

// AppConfig 是运行时组装出的顶层应用配置。
type AppConfig struct {
	AI        AIConfig      // AI 模型调用配置。
	Lookback  time.Duration // 抓取内容的时间回溯窗口。
	StatePath string        // 上一次抓取快照的写入路径。
}

// AIConfig 描述调用 OpenAI 兼容 chat/completions 接口所需的凭据与参数。
type AIConfig struct {
	APIKey    string         // 鉴权用的 API Key（Bearer 令牌）。
	BaseURL   string         // 模型服务地址，末尾不带斜杠。
	Model     string         // 使用的模型名。
	ExtraBody map[string]any // 透传到请求体的额外字段（如 temperature），不含 model/messages/stream。
}

// RSS2Source 描述 RSS 2.0 来源的抓取方式，具体分页规则由来源适配器提供。
type RSS2Source struct {
	ID               string                         // 源的唯一标识，用于生成稳定 ID 与状态记录。
	Name             string                         // 源的展示名称（终端输出与来源标注使用）。
	MaxPages         int                            // 最多翻页数。
	PageStart        int                            // 起始页码。
	PageDelaySeconds int                            // 翻页之间的延迟秒数。
	PageURL          func(page int) (string, error) // 来源适配器提供的分页地址生成器。
	AdaptItem        func(Item) Item                // 来源适配器提供的条目标准化扩展。
}

// Item 是从 RSS 2.0 解析并标准化后的单条资讯，贯穿评分、聚类与报告生成流程。
type Item struct {
	ID          string    // 原始 GUID/ID，缺失时回退为链接。
	StableID    string    // 来源适配器提供的稳定标识，可用于生成下游 ID。
	SourceID    string    // 来源 ID，用于生成稳定指纹与 ID。
	SourceName  string    // 来源展示名称。
	Title       string    // 标题（已去除 HTML 标签）。
	Link        string    // 原文链接。
	PubDate     string    // 格式化后的发布时间（RFC1123），仅用于展示。
	PublishedAt time.Time // 解析后的发布时间，用于时间窗口过滤与排序。
	Description string    // 正文/摘要，可能含 HTML。
	Creator     string    // 作者/发布者。
}

// ChatRequest 是发送给 OpenAI 兼容 chat/completions 接口的请求体。
type ChatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

// ChatMessage 是对话消息中的一条（system/user/assistant）。
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatResponse 是 chat/completions 接口的响应体，这里只关心 choices。
type ChatResponse struct {
	Choices []ChatChoice `json:"choices"`
}

// ChatChoice 是模型返回的一个候选回复。
type ChatChoice struct {
	Message ChatMessage `json:"message"`
}

// ScoredItem 是经过评分的一条候选，包含模型分数、理由与代码层关键词保底分。
type ScoredItem struct {
	Index        int    `json:"index"`  // 对应原始 items 列表中的 1 基序号。
	Title        string `json:"title"`  // 候选标题。
	Score        int    `json:"score"`  // 综合分数（满分 10）。
	Reason       string `json:"reason"` // 入选理由。
	KeywordScore int    `json:"-"`      // 关键词规则给出的保底分，不写入 JSON。
}

// NewsGroup 是聚类后的一个 Story（视频主题），由若干来源与不重复要点组成。
type NewsGroup struct {
	Title           string          `json:"title"`                      // 合并后的 Story 标题。
	NavigationTitle string          `json:"navigation_title,omitempty"` // 底部时间线短标题，最终长度按整条导航容量适配。
	Score           int             `json:"score"`                      // 主题重要性分数。
	Reason          string          `json:"reason"`                     // 为何值得关注。
	SourceIndexes   []int           `json:"source_indexes"`             // 归入本 Story 的全部候选序号（含重复来源）。
	Highlights      []NewsHighlight `json:"highlights"`                 // 互不重复的关键要点。
	Tabs            []StoryTab      `json:"tabs,omitempty"`             // 后续编排出的视频 Tabs。
	lastRejected    []rejectedTab   `json:"-"`                          // 运行时缓存：最近一次 Tab 归一化被丢弃的项，供带反馈重试使用。
}

// NewsHighlight 是 Story 内的一个不重复要点，指向最能代表它的来源序号。
type NewsHighlight struct {
	Index int    `json:"index"` // 来源序号（1 基）。
	Point string `json:"point"` // 具体信息点描述。
}

// StoryTab 是 Story 下的一个视频 Tab，包含标题、画面摘要与口播字幕。
type StoryTab struct {
	Title            string `json:"title"`            // Tab 标题。
	Summary          string `json:"summary"`          // 画面中展示的完整摘要（受限 Markdown）。
	Subtitle         string `json:"subtitle"`         // 底部弹幕与 TTS 口播字幕。
	Kind             string `json:"kind"`             // 类型：fact（事实）、impact（影响）或 watch（待观察）。
	EvidenceIndexes  []int  `json:"evidence_indexes"` // 支撑该 Tab 的来源序号。
	subtitleFallback bool   `json:"-"`                // 运行时质量标记：模型字幕无效，已从 summary/title 降级生成。
}

// StoryTabsResult 是模型针对某个 Story 返回的 Tabs 集合，GroupIndex 对应 Story 序号。
type StoryTabsResult struct {
	GroupIndex int        `json:"group_index"` // Story 序号（1 基）。
	Tabs       []StoryTab `json:"tabs"`        // 该 Story 的 Tabs。
}
