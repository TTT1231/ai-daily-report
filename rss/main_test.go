package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestKeywordInterestScore(t *testing.T) {
	tests := []struct {
		name      string
		title     string
		wantScore int
	}{
		{
			name:      "GLM product change gets strong priority",
			title:     "智谱1倍消耗或持续到九月底，5.2也开始Max用户内测了",
			wantScore: 9,
		},
		{
			name:      "national AI regulation is highest priority",
			title:     "中央网信办举报中心开设“涉AI应用乱象举报专区”",
			wantScore: 10,
		},
		{
			name:      "AI clear campaign is deterministically retained",
			title:     "6.12 AI清朗清剿",
			wantScore: 10,
		},
		{
			name:      "intermediary promotion is excluded",
			title:     "超低价GPT Claude API中转，限时优惠，注册送余额",
			wantScore: 0,
		},
		{
			name:      "intermediary risk is retained",
			title:     "某低价GPT API中转站疑似跑路，用户余额无法提现",
			wantScore: 8,
		},
		{
			name:      "unrelated major news is excluded",
			title:     "SpaceX创下人类最大IPO",
			wantScore: 0,
		},
		{
			name:      "brand mention alone does not force inclusion",
			title:     "OpenAI发表与ChatGPT产品使用无关的公司表态",
			wantScore: 6,
		},
		{
			name:      "geopolitical OpenAI story is excluded",
			title:     "OpenAI称与中国关联的ChatGPT账户试图煽动美国国内反对数据中心建设",
			wantScore: 0,
		},
		{
			name:      "geopolitical account statement remains excluded",
			title:     "OpenAI称中国关联ChatGPT账号参与国际舆论操纵",
			wantScore: 0,
		},
		{
			name:      "Kimi marketing campaign is excluded",
			title:     "【kimi】预测冠军队 抢万亿Token",
			wantScore: 0,
		},
		{
			name:      "DeepSeek model release gets strong priority",
			title:     "DeepSeek V4 正式发布并开放 API",
			wantScore: 9,
		},
		{
			name:      "Qwen model release gets strong priority",
			title:     "通义千问 Qwen 新模型发布并开源",
			wantScore: 9,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score, _ := keywordInterestScore(tt.title)
			if score != tt.wantScore {
				t.Fatalf("keywordInterestScore(%q) = %d, want %d", tt.title, score, tt.wantScore)
			}
		})
	}
}

func TestPassesDeterministicInterestGate(t *testing.T) {
	tests := []struct {
		title string
		score int
		want  bool
	}{
		{"智谱1倍消耗或持续到九月底，5.2也开始Max用户内测了", 7, true},
		{"6.12 AI清朗清剿", 9, true},
		{"某低价GPT API中转站疑似跑路", 8, true},
		{"快讯，antigravity支持额度显示了", 8, false},
		{"DigitalOcean学生包200美元额度到期时间统一重置为8.1", 9, false},
		{"甲骨文arm免费额度砍半", 9, false},
		{"Agent上岗考试：最难任务仍交白卷", 8, false},
		{"某厂商发布并开源新模型，或将改变AI行业竞争", 9, true},
		{"DeepSeek V4 正式发布并开放 API", 7, true},
		{"Qwen 新模型发布并开源", 7, true},
	}

	for _, tt := range tests {
		if got := passesDeterministicInterestGate(tt.title, tt.score); got != tt.want {
			t.Fatalf("passesDeterministicInterestGate(%q, %d) = %v, want %v", tt.title, tt.score, got, tt.want)
		}
	}
}

func TestFallbackGroupIdentity(t *testing.T) {
	tests := []struct {
		title   string
		wantKey string
	}{
		{"OpenAI Codex 额度重置现在可“存起来”稍后使用", "codex-quota-reset"},
		{"真支持自助重置了啊，codex-plus和pro有一次免费重置", "codex-quota-reset"},
		{"Moonshotai 开源Kimi K2.7 Code", "kimi-*"},
		{"Kimi K2.7 Code 编程模型已上线 API 开放平台", "kimi-*"},
		{"Kimi2.6 编程模型更新", "kimi-*"},
		{"智谱 GLM-4.7 发布", "glm-*"},
		{"智谱 GLM-5.2 开始 Max 用户内测", "glm-*"},
		{"GLM5 发布新版本", "glm-*"},
		{"智谱一倍消耗持续到九月底，5.3 开始内测", "glm-*"},
		{"GLM 账号大规模被封", "glm-account-risk"},
		{"Claude 4.9 正式发布并开放 API", "claude-*"},
		{"Anthropic Claude 账号大规模被封", "claude-account-risk"},
		{"DeepSeek V4 正式发布并开放 API", "deepseek-*"},
		{"深度求索新模型发布", "deepseek-*"},
		{"Qwen3.5 正式发布并开源", "qwen-*"},
		{"Qween 新模型上线", "qwen-*"},
		{"通义千问模型更新", "qwen-*"},
		{"阿里云百炼上线 Qwen 新模型", "qwen-*"},
	}

	for _, tt := range tests {
		key, _ := fallbackGroupIdentity(tt.title)
		if key != tt.wantKey {
			t.Fatalf("fallbackGroupIdentity(%q) = %q, want %q", tt.title, key, tt.wantKey)
		}
	}
}

func TestSplitIncompatibleGroups(t *testing.T) {
	items := []Item{
		{Title: "用了半个月的plus号突然全被杀了，上一个杀一个"},
		{Title: "OpenAI称关联账户试图煽动反对数据中心建设"},
	}
	candidates := map[int]ScoredItem{
		1: {Index: 1, Score: 8},
		2: {Index: 2, Score: 7},
	}
	groups := []NewsGroup{{
		Title:         "错误的宽泛 OpenAI 分组",
		SourceIndexes: []int{1, 2},
		Highlights: []NewsHighlight{
			{Index: 1, Point: items[0].Title},
			{Index: 2, Point: items[1].Title},
		},
	}}

	got := splitIncompatibleGroups(groups, candidates, items)
	if len(got) != 2 {
		t.Fatalf("splitIncompatibleGroups() returned %d groups, want 2", len(got))
	}
}

func TestStripHTML(t *testing.T) {
	got := stripHTML(`<p>智谱运维人员在群内表示，<strong>一倍消耗</strong>可能持续到九月底。</p><p>Max 用户开始内测。</p>`)
	if strings.Contains(got, "<") || !strings.Contains(got, "一倍消耗") || !strings.Contains(got, "Max 用户") {
		t.Fatalf("stripHTML() = %q", got)
	}
}

func TestWithFallbackStoryTabsGuaranteesMinimumUsefulTabs(t *testing.T) {
	groups := []NewsGroup{{
		Title:         "智谱 GLM 消耗倍率或调整至九月底，Max 用户内测开启",
		Score:         10,
		Reason:        "智谱一倍消耗政策可能延续至九月底，同时 5.2 版本开始 Max 用户内测。",
		SourceIndexes: []int{1},
	}}

	got := withFallbackStoryTabs(groups)
	if len(got[0].Tabs) < minStoryTabs {
		t.Fatalf("got %d tabs, want at least %d", len(got[0].Tabs), minStoryTabs)
	}
	for _, tab := range got[0].Tabs {
		if utf8.RuneCountInString(tab.Summary) < minTabSummaryRunes {
			t.Fatalf("tab summary too short: %q", tab.Summary)
		}
		if len(tab.EvidenceIndexes) == 0 || tab.EvidenceIndexes[0] != 1 {
			t.Fatalf("tab has invalid evidence: %#v", tab.EvidenceIndexes)
		}
	}
}

func TestNormalizeStoryTabsRejectsShortAndUnknownEvidence(t *testing.T) {
	group := NewsGroup{SourceIndexes: []int{2}}
	tabs := []StoryTab{
		{Title: "太短", Summary: "内容太短", Kind: "fact", EvidenceIndexes: []int{2}},
		{
			Title:           "无效证据",
			Summary:         "这是一个长度足够且能够用于视频展示的完整信息摘要内容。",
			Kind:            "unknown",
			EvidenceIndexes: []int{99},
		},
		{
			Title:           "有效内容",
			Summary:         "这是另一个长度足够且具有有效来源证据的完整信息摘要内容。",
			Kind:            "unknown",
			EvidenceIndexes: []int{2},
		},
	}

	got := normalizeStoryTabs(group, tabs)
	if len(got) != 1 {
		t.Fatalf("got %d tabs, want 1", len(got))
	}
	if got[0].Kind != "fact" || len(got[0].EvidenceIndexes) != 1 || got[0].EvidenceIndexes[0] != 2 {
		t.Fatalf("unexpected normalized tab: %#v", got[0])
	}
}

func TestParseScoredItemsRecoversMalformedLine(t *testing.T) {
	content := `[
  {"index": 1, "title": "智谱发布GLM更新", "score": 10, "reason": "重点模型更新"},
  {"index": 2, "title": "微软最糟糕的 "Nightmare "引发漏洞", "score": 1, "reason": "无关"},
  {"index": 3, "title": "Codex额度重置", "score": 9, "reason": "影响使用权益"}
]`

	got, err := parseScoredItems(content)
	if err != nil {
		t.Fatalf("parseScoredItems() error = %v", err)
	}
	if len(got) != 2 || got[0].Index != 1 || got[1].Index != 3 {
		t.Fatalf("parseScoredItems() = %#v", got)
	}
}

func TestGenerateDataJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	groups := []NewsGroup{{
		Title:  "智谱 GLM-5.2 与消耗规则动态",
		Reason: "影响用户使用成本",
		Tabs: []StoryTab{
			{Title: "消耗规则", Summary: "智谱非高峰期一倍消耗计划可能持续到九月底。"},
			{Title: "内测进展", Summary: "GLM-5.2 已开始面向 Max 用户进行小范围内测。"},
		},
	}}

	items := []Item{{Title: "智谱1倍消耗或持续到九月底，5.2也开始Max用户内测了", Link: "https://linux.do/t/topic/2388502"}}
	groups[0].SourceIndexes = []int{1}
	groups[0].Highlights = []NewsHighlight{{Index: 1, Point: items[0].Title}}

	if err := generateDataJSON(path, groups, items); err != nil {
		t.Fatalf("generateDataJSON() error = %v", err)
	}
	if err := generateDataJSON(path, groups, items); err != nil {
		t.Fatalf("generateDataJSON() overwrite error = %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"stories"`) || !strings.Contains(string(data), `"tabs"`) {
		t.Fatalf("unexpected report data: %s", data)
	}
	if !strings.Contains(string(data), `"introTitle": "智谱 GLM-5.2 与消耗规则动态"`) {
		t.Fatalf("report data should preserve full intro title: %s", data)
	}
	if strings.Contains(string(data), `"activeTab"`) {
		t.Fatalf("two-tab story should omit activeTab: %s", data)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "data.json" {
		t.Fatalf("report directory contains unexpected files: %#v", entries)
	}
}

func TestTopTitleSegmentCountLimitsOverGrouping(t *testing.T) {
	stories := []DataJSONStory{
		{TopTitle: "行业动态"},
		{TopTitle: "模型产品"},
		{TopTitle: "模型产品"},
		{TopTitle: "模型产品"},
		{TopTitle: "额度价格"},
	}
	got := topTitleSegmentCount(stories)
	if got != 3 {
		t.Fatalf("topTitleSegmentCount() = %d, want 3", got)
	}
	if len(stories)-got > maxTopBottomSegmentGap {
		t.Fatalf("valid grouping gap = %d, want <= %d", len(stories)-got, maxTopBottomSegmentGap)
	}
}

func TestMigratedProjectPathsUseParentRoot(t *testing.T) {
	root, err := projectRoot()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(root) != "ai-daily-report" {
		t.Fatalf("projectRoot() = %q", root)
	}
	envPath, err := projectEnvPath()
	if err != nil {
		t.Fatal(err)
	}
	if envPath != filepath.Join(root, ".env") {
		t.Fatalf("projectEnvPath() = %q", envPath)
	}
	t.Setenv("REPORT_DATA_PATH", "")
	reportPath, err := defaultDataJSONPath()
	if err != nil {
		t.Fatal(err)
	}
	if reportPath != filepath.Join(root, "data-scheme", "data.json") {
		t.Fatalf("defaultDataJSONPath() = %q", reportPath)
	}
}

func TestStoryIDUsesStableSourceIdentity(t *testing.T) {
	items := []Item{{Title: "月之暗面 Kimi 将发行融合算力服务的 AI 原生信用卡", StableID: "topic-2386790"}}
	group := NewsGroup{
		Title:         "DeepSeek 每次可能改写的信用卡标题",
		SourceIndexes: []int{1},
		Highlights:    []NewsHighlight{{Index: 1}},
	}
	if got := storyID(group, items); got != "topic-2386790" {
		t.Fatalf("storyID() = %q, want topic-2386790", got)
	}
}

func TestPreferredActiveTabUsesVisualCenter(t *testing.T) {
	tabs := []DataJSONTab{
		{ID: "tab-1"},
		{ID: "tab-2"},
		{ID: "tab-3"},
		{ID: "tab-4"},
		{ID: "tab-5"},
	}
	if got := preferredActiveTab(tabs[:2]); got != "" {
		t.Fatalf("preferredActiveTab(2 tabs) = %q, want empty", got)
	}
	for count := 3; count <= 5; count++ {
		if got := preferredActiveTab(tabs[:count]); got != "tab-2" {
			t.Fatalf("preferredActiveTab(%d tabs) = %q, want tab-2", count, got)
		}
	}
}

func TestStoryCategoryDoesNotTreatProductPolicyAsRegulation(t *testing.T) {
	group := NewsGroup{
		Title:  "智谱GLM：1倍消耗或持续到九月底，5.2开始Max用户内测",
		Reason: "智谱调整GLM消耗倍率政策，并开始模型内测",
	}
	if got := storyCategory(group); got != "模型产品" {
		t.Fatalf("storyCategory() = %q, want 模型产品", got)
	}
}

func TestStoryCategoryPrioritizesQuotaOverAccountMention(t *testing.T) {
	group := NewsGroup{
		Title:  "OpenAI Codex额度重置政策更新",
		Reason: "直接影响用户账号和资源管理",
	}
	if got := storyCategory(group); got != "额度价格" {
		t.Fatalf("storyCategory() = %q, want 额度价格", got)
	}
}

func TestStoryCategoryPrioritizesQuotaOverModelMention(t *testing.T) {
	group := NewsGroup{
		Title:  "Claude Code额度重置并提升50%",
		Reason: "作为模型下架补偿，订阅用户额度重置并临时提升。",
	}
	if got := storyCategory(group); got != "额度价格" {
		t.Fatalf("storyCategory() = %q, want 额度价格", got)
	}
}

func TestNavigationTitleIsShort(t *testing.T) {
	group := NewsGroup{Title: "OpenAI Codex 额度重置规则大更新：可储存、免费重置、邀请新人重置"}
	got := navigationTitle(group)
	if utf8.RuneCountInString(got) > maxBottomTitleRunes {
		t.Fatalf("navigationTitle() length = %d, want <= %d: %q", utf8.RuneCountInString(got), maxBottomTitleRunes, got)
	}
	if got != "额度重置" {
		t.Fatalf("navigationTitle() = %q, want 额度重置", got)
	}
}

func TestNavigationTitleUsesValidDeepSeekSuggestion(t *testing.T) {
	group := NewsGroup{
		Title:           "一个很长的完整新闻标题",
		NavigationTitle: "Ona收购",
	}
	if got := navigationTitle(group); got != "Ona收购" {
		t.Fatalf("navigationTitle() = %q, want Ona收购", got)
	}
}

func TestNormalizeSceneSubtitleRemovesMarkdownAndLimitsLength(t *testing.T) {
	got := normalizeSceneSubtitle("`GLM-5.2` 已开启 **Max 用户小范围内测**，具体参数仍待公布。")
	if strings.Contains(got, "`") || strings.Contains(got, "**") {
		t.Fatalf("normalizeSceneSubtitle() kept markdown: %q", got)
	}
	if utf8.RuneCountInString(got) > maxSceneSubtitleRunes {
		t.Fatalf("normalizeSceneSubtitle() too long: %q", got)
	}
}

func TestSceneSubtitleDoesNotRepeatFullSummary(t *testing.T) {
	tab := StoryTab{
		Summary:  "`Codex` 推出额度存储与邀请重置机制，用户可以灵活安排使用时间并降低额外支出。",
		Subtitle: "Codex额度重置现在可以存起来，用户能够按需选择重置时间。",
	}
	got := sceneSubtitle(tab)
	if got != tab.Subtitle {
		t.Fatalf("sceneSubtitle() = %q, want %q", got, tab.Subtitle)
	}
}

func TestSceneSubtitleFallsBackToSummaryFact(t *testing.T) {
	tab := StoryTab{
		Title:    "用户影响",
		Summary:  "新模型上线可能导致 Codex 额度被大量消耗，有用户担心免费额度更快用完。",
		Subtitle: "用户影响，实际影响请看卡片内容。",
		Kind:     "impact",
	}
	got := sceneSubtitle(tab)
	if got != "新模型上线可能导致 Codex 额度被大量消耗，有用户担心免费额度更快用完。" {
		t.Fatalf("sceneSubtitle() = %q", got)
	}
}

func TestSceneSubtitleRejectsIncompleteCauseAndUsesFullFact(t *testing.T) {
	tab := StoryTab{
		Summary:  "因美国政府出口管制指令，Anthropic 已禁止所有用户使用 `Claude Fable 5` 和 `Claude Mythos 5`，所有渠道均不可用，用户可通过 `/model` 切换到其他模型。",
		Subtitle: "因美国政府出口管制指令。",
	}
	got := sceneSubtitle(tab)
	if got != "因美国政府出口管制指令，Anthropic 已禁止所有用户使用 Claude Fable 5 和 Claude Mythos 5，所有渠道均不可用，用户可通过 /model 切换到其他模型。" {
		t.Fatalf("sceneSubtitle() = %q", got)
	}
}

func TestNormalizeSceneSubtitleRejectsInterfaceDirections(t *testing.T) {
	if got := normalizeSceneSubtitle("用户影响，实际影响请看卡片内容。"); got != "" {
		t.Fatalf("normalizeSceneSubtitle() = %q, want empty", got)
	}
}

func TestNavigationTitleRejectsLongDeepSeekSuggestion(t *testing.T) {
	group := NewsGroup{
		Title:           "OpenAI Codex 额度重置规则大更新",
		NavigationTitle: "OpenAI Codex 额度重置规则大更新",
	}
	if got := navigationTitle(group); got != "额度重置" {
		t.Fatalf("navigationTitle() = %q, want 额度重置", got)
	}
}

func TestNavigationTitleRejectsVacuousSuggestionAtWriteTime(t *testing.T) {
	group := NewsGroup{
		Title:           "OpenAI Codex 额度重置规则大更新",
		NavigationTitle: "行业动态",
	}
	if got := navigationTitle(group); got != "额度重置" {
		t.Fatalf("navigationTitle() = %q, want 额度重置", got)
	}
}

func TestExtractRemoteImageURLsPrefersOriginals(t *testing.T) {
	description := `<a href="https://cdn.example.com/original/abc/image.jpeg"><img src="https://cdn.example.com/optimized/abc/image_2_690x388.jpeg"></a>
		<a href="https://cdn.example.com/original/abc/image.jpeg">重复原图</a>`

	got := extractRemoteImageURLs(description)
	if len(got) != 1 || got[0] != "https://cdn.example.com/original/abc/image.jpeg" {
		t.Fatalf("extractRemoteImageURLs() = %#v", got)
	}
}

func TestExtractRemoteImageURLsFallsBackToSrc(t *testing.T) {
	description := `<img src="https://cdn.example.com/optimized/abc/image.webp?width=690">`
	got := extractRemoteImageURLs(description)
	if len(got) != 1 || got[0] != "https://cdn.example.com/optimized/abc/image.webp?width=690" {
		t.Fatalf("extractRemoteImageURLs() = %#v", got)
	}
}

func TestFormatVisionMaterial(t *testing.T) {
	got := formatVisionMaterial([]VisionResult{{
		Relevant:  true,
		Facts:     []string{"外国用户被禁止访问两款模型"},
		Uncertain: []string{"恢复时间尚未明确"},
	}})
	if !strings.Contains(got, "图片证据") ||
		!strings.Contains(got, "- 外国用户被禁止访问两款模型") ||
		!strings.Contains(got, "- [不确定] 恢复时间尚未明确") {
		t.Fatalf("formatVisionMaterial() = %q", got)
	}
}

func TestVisionAnalyzerShouldAnalyzeOnlyHighPriorityShortImageSource(t *testing.T) {
	analyzer := &VisionAnalyzer{enabled: true, maxCalls: 4, textThreshold: 500}
	item := Item{
		Title:       "Anthropic 禁用两款模型",
		Description: `<p>正文很短。</p><img src="https://cdn.example.com/image.png">`,
	}
	if !analyzer.shouldAnalyze(item, NewsGroup{Score: 9}) {
		t.Fatal("shouldAnalyze() = false, want true")
	}
	if analyzer.shouldAnalyze(item, NewsGroup{Score: 8}) {
		t.Fatal("shouldAnalyze() accepted low-priority source")
	}
}

func TestExtractJSONObjectFromClaudeText(t *testing.T) {
	got := extractJSONObject("分析完成。\n```json\n{\"relevant\":true,\"facts\":[\"事实\"]}\n```")
	if got != `{"relevant":true,"facts":["事实"]}` {
		t.Fatalf("extractJSONObject() = %q", got)
	}
}

func TestParseClaudeVisionStructuredOutput(t *testing.T) {
	output := []byte(`{"type":"result","structured_output":{"relevant":true,"facts":["外国用户被限制访问"],"uncertain":[],"summary":"模型访问受限"}}`)
	var got VisionResult
	if err := parseClaudeVisionOutput(output, &got); err != nil {
		t.Fatal(err)
	}
	if !got.Relevant || len(got.Facts) != 1 || got.Facts[0] != "外国用户被限制访问" {
		t.Fatalf("parseClaudeVisionOutput() = %#v", got)
	}
}

func TestParseClaudeVisionFallsBackToTextResult(t *testing.T) {
	output := []byte(`{"type":"result","result":"` + "`json\\n" + `{\"relevant\":false,\"facts\":[],\"uncertain\":[],\"summary\":\"\"}` + "\\n```" + `"}`)
	var got VisionResult
	if err := parseClaudeVisionOutput(output, &got); err != nil {
		t.Fatal(err)
	}
	if got.Relevant || len(got.Facts) != 0 {
		t.Fatalf("parseClaudeVisionOutput() = %#v", got)
	}
}

func TestParseRSS20ToNormalizedItems(t *testing.T) {
	source := RSS2Source{ID: "test", Name: "测试源"}
	rssBody := []byte(`<?xml version="1.0"?><rss version="2.0"><channel><item>
		<guid>rss-1</guid><title>RSS 标题</title><link>https://example.com/rss-1</link>
		<pubDate>Sat, 13 Jun 2026 08:00:00 +0000</pubDate><description>RSS 正文</description>
	</item></channel></rss>`)
	rssItems, err := parseRSS2(rssBody, source)
	if err != nil {
		t.Fatal(err)
	}
	if len(rssItems) != 1 || rssItems[0].ID != "rss-1" || rssItems[0].SourceName != "测试源" {
		t.Fatalf("parseRSS2() = %#v", rssItems)
	}
}

func TestParseRSSRejectsUnsupportedFormats(t *testing.T) {
	source := RSS2Source{ID: "test", Name: "测试源"}
	for _, body := range []string{
		`<rss version="1.0"><channel></channel></rss>`,
		`<rss><channel></channel></rss>`,
		`<feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
	} {
		if _, err := parseRSS2([]byte(body), source); err == nil {
			t.Fatalf("parseRSS2() accepted unsupported feed: %s", body)
		}
	}
}

func TestLinuxDoPageURL(t *testing.T) {
	got, err := linuxDoPageURL(2)
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://linux.do/c/news/34.rss?page=2" {
		t.Fatalf("linuxDoPageURL() = %q", got)
	}
}

func TestLinuxDoAdapterAddsStableTopicID(t *testing.T) {
	item := adaptLinuxDoItem(Item{Link: "https://linux.do/t/topic/2386790"})
	if item.StableID != "topic-2386790" {
		t.Fatalf("adaptLinuxDoItem() StableID = %q", item.StableID)
	}
}

func TestRSSStateOnlyComparesWithPreviousSnapshot(t *testing.T) {
	a1 := Item{ID: "a1", SourceID: "source", Title: "A1"}
	a2 := Item{ID: "a2", SourceID: "source", Title: "A2"}
	b1 := Item{ID: "b1", SourceID: "source", Title: "B1"}
	state := snapshotRSSState([]Item{a1, a2})

	got := filterUnseenItems([]Item{a2, b1}, state)
	if len(got) != 1 || got[0].ID != "b1" {
		t.Fatalf("filterUnseenItems() = %#v", got)
	}

	path := filepath.Join(t.TempDir(), "rss-state.json")
	if err := saveRSSState(path, snapshotRSSState([]Item{a2, b1})); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadRSSState(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Items) != 2 {
		t.Fatalf("loaded state contains %d items, want 2", len(loaded.Items))
	}
	got = filterUnseenItems([]Item{a1, b1}, loaded)
	if len(got) != 1 || got[0].ID != "a1" {
		t.Fatalf("filterUnseenItems() should forget items absent from previous snapshot: %#v", got)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "rss-state.json" {
		t.Fatalf("state directory contains unexpected files: %#v", entries)
	}
}

func TestRequestModelUsesOpenAICompatibleChatCompletions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("request path = %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "test-model" || body["temperature"] != float64(0) {
			t.Fatalf("request body = %#v", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`))
	}))
	defer server.Close()

	got, err := requestModel(AIConfig{
		APIKey:    "test-key",
		BaseURL:   server.URL,
		Model:     "test-model",
		ExtraBody: map[string]any{"temperature": 0},
	}, []ChatMessage{{Role: "user", Content: "hello"}})
	if err != nil {
		t.Fatal(err)
	}
	if got != "ok" {
		t.Fatalf("requestModel() = %q", got)
	}
}

func TestSourceStoryIDIsStableForGenericSource(t *testing.T) {
	item := Item{ID: "entry-123", SourceID: "official-openai", Title: "模型发布"}
	first := sourceStoryID(item)
	second := sourceStoryID(item)
	if first != second || !strings.HasPrefix(first, "official-openai-") {
		t.Fatalf("sourceStoryID() = %q / %q", first, second)
	}
}

func TestCleanNavigationTitleRejectsOutOfRange(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"too short", "AI"},
		{"too long", "OpenAI Codex 额度重置规则大更新"},
		{"empty", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := cleanNavigationTitle(tc.input); got != "" {
				t.Fatalf("cleanNavigationTitle(%q) = %q, want empty", tc.input, got)
			}
		})
	}
}

func TestCleanNavigationTitleRejectsVacuousLabel(t *testing.T) {
	// 纯栏目名长度合规但无具体事件信息，应被清空，交给下游降级。
	vacuous := []string{"事件概览", "用户影响", "后续观察", "AI动态", "最新消息"}
	for _, input := range vacuous {
		if got := cleanNavigationTitle(input); got != "" {
			t.Fatalf("cleanNavigationTitle(%q) = %q, want empty", input, got)
		}
	}
}

func TestCleanNavigationTitleKeepsConciseLabel(t *testing.T) {
	// 有“主体+事件”的具体短标题应保留。
	for _, input := range []string{"额度重置", "Ona收购", "智谱内测"} {
		if got := cleanNavigationTitle(input); got != input {
			t.Fatalf("cleanNavigationTitle(%q) = %q, want %q", input, got, input)
		}
	}
}

func TestNormalizeSceneSubtitleRejectsColumnNamePrefix(t *testing.T) {
	// 栏目名作为前缀或开头的字幕应被拒收（与 prompts.go subtitle 规则对齐）。
	for _, input := range []string{
		"用户影响：免费额度可能更快耗尽，开发者需要注意成本控制。",
		"后续观察：具体细节仍需等待官方公告确认，建议持续关注。",
		"事件概览：OpenAI 发布了全新模型，能力大幅提升。",
		"请看 Tab 中的详细内容了解全部变化。",
	} {
		if got := normalizeSceneSubtitle(input); got != "" {
			t.Fatalf("normalizeSceneSubtitle(%q) = %q, want empty", input, got)
		}
	}
}

func TestNormalizeSceneSubtitleAllowsColumnNameInNaturalSentence(t *testing.T) {
	input := "这项额度调整对用户影响较小，但企业账户仍需要重新规划调用频率。"
	if got := normalizeSceneSubtitle(input); got != input {
		t.Fatalf("normalizeSceneSubtitle(%q) = %q, want unchanged", input, got)
	}
}

func TestTabRejectionReason(t *testing.T) {
	// 空标题。
	if got := tabRejectionReason(StoryTab{Title: "", Summary: "这是一段足够长的摘要内容用于通过字数校验。"}); got == "" {
		t.Fatalf("tabRejectionReason() for empty title should not be empty")
	}
	// summary 过短。
	if got := tabRejectionReason(StoryTab{Title: "事件概览", Summary: "太短"}); got == "" {
		t.Fatalf("tabRejectionReason() for short summary should not be empty")
	}
	// 合格返回空串。
	got := tabRejectionReason(StoryTab{
		Title:   "事件概览",
		Summary: "这是一段足够长的摘要内容用于通过字数校验。",
	})
	if got != "" {
		t.Fatalf("tabRejectionReason() for valid tab = %q, want empty", got)
	}
}

func TestNormalizeStoryTabsWithReasonsCapturesRejections(t *testing.T) {
	group := NewsGroup{SourceIndexes: []int{1}}
	tabs := []StoryTab{
		{Title: "完整标题", Summary: "这是一段足够长的摘要内容用于通过字数校验。", Subtitle: "GLM-5.2 已开启 Max 用户小范围内测，具体参数仍待公布。", EvidenceIndexes: []int{1}},
		{Title: "", Summary: "被丢弃因为标题为空"},
		{Title: "短摘要", Summary: "太短"},
	}
	normalized, rejected := normalizeStoryTabsWithReasons(group, tabs)
	if len(normalized) != 1 {
		t.Fatalf("normalized count = %d, want 1", len(normalized))
	}
	if len(rejected) != 2 {
		t.Fatalf("rejected count = %d, want 2", len(rejected))
	}
	for _, r := range rejected {
		if r.Reason == "" {
			t.Fatalf("rejected tab has empty reason: %#v", r)
		}
	}
}

func TestNormalizeStoryTabsWithReasonsRejectsMissingEvidence(t *testing.T) {
	group := NewsGroup{SourceIndexes: []int{1}}
	tabs := []StoryTab{{
		Title:   "完整标题",
		Summary: "这是一段足够长但没有有效来源证据的摘要内容。",
	}}
	normalized, rejected := normalizeStoryTabsWithReasons(group, tabs)
	if len(normalized) != 0 || len(rejected) != 1 {
		t.Fatalf("normalizeStoryTabsWithReasons() = %#v / %#v", normalized, rejected)
	}
	if !strings.Contains(rejected[0].Reason, "evidence_indexes") {
		t.Fatalf("rejection reason = %q, want evidence feedback", rejected[0].Reason)
	}
}

func TestCollectStoryTabRetriesIncludesMissingAndShortStories(t *testing.T) {
	groups := []NewsGroup{
		{Title: "漏返回", SourceIndexes: []int{1}},
		{
			Title:         "只有一个",
			SourceIndexes: []int{2},
			Tabs: []StoryTab{{
				Title:           "事件概览",
				Summary:         "这是一段足够长且有来源证据的完整信息摘要内容。",
				Subtitle:        "这是一段完整有效的新闻口播字幕，用于测试数量不足时仍会进入批量重试。",
				EvidenceIndexes: []int{2},
			}},
		},
		{
			Title:         "已经达标",
			SourceIndexes: []int{3},
			Tabs: []StoryTab{
				{Title: "一", Summary: "这是一段足够长且有来源证据的完整信息摘要内容。", EvidenceIndexes: []int{3}},
				{Title: "二", Summary: "这是另一段足够长且有来源证据的完整信息摘要内容。", EvidenceIndexes: []int{3}},
			},
		},
	}
	batch := []storyTabMaterial{{GroupIndex: 1}, {GroupIndex: 2}, {GroupIndex: 3}}

	retryBatch, feedbacks := collectStoryTabRetries(groups, batch)
	if len(retryBatch) != 2 {
		t.Fatalf("retry batch count = %d, want 2", len(retryBatch))
	}
	if !strings.Contains(strings.Join(feedbacks[1], "；"), "未返回") {
		t.Fatalf("missing Story feedback = %#v", feedbacks[1])
	}
	if !strings.Contains(strings.Join(feedbacks[2], "；"), "当前只有 1 个") {
		t.Fatalf("short Story feedback = %#v", feedbacks[2])
	}
}

func TestBetterStoryTabsPrefersEvidenceCoverageAtSameCount(t *testing.T) {
	group := NewsGroup{
		SourceIndexes: []int{1, 2},
		Highlights:    []NewsHighlight{{Index: 1}, {Index: 2}},
	}
	current := []StoryTab{
		{Title: "一", EvidenceIndexes: []int{1}},
		{Title: "二", EvidenceIndexes: []int{1}},
	}
	candidate := []StoryTab{
		{Title: "一", EvidenceIndexes: []int{1}},
		{Title: "二", EvidenceIndexes: []int{2}},
	}
	if !betterStoryTabs(group, candidate, current) {
		t.Fatal("betterStoryTabs() did not prefer broader highlight/evidence coverage")
	}
}

func TestBuildStoryTabsPromptIncludesFeedback(t *testing.T) {
	batch := []storyTabMaterial{
		{GroupIndex: 1, Body: "Story 1\n主题：测试"},
		{GroupIndex: 2, Body: "Story 2\n主题：测试二"},
	}
	feedbacks := map[int][]string{1: {"summary 仅 5 字，不足 20 字下限"}}

	prompt := buildStoryTabsPrompt(batch, feedbacks)
	if !strings.Contains(prompt, "需要修正的 Story") {
		t.Fatalf("prompt missing feedback section:\n%s", prompt)
	}
	if !strings.Contains(prompt, "summary 仅 5 字，不足 20 字下限") {
		t.Fatalf("prompt missing specific feedback reason:\n%s", prompt)
	}
	// 未带反馈的 Story 不应出现在修正段。
	if !strings.Contains(prompt, "Story 1 上轮生成") {
		t.Fatalf("prompt missing Story 1 correction note:\n%s", prompt)
	}
}

func TestBuildStoryTabsPromptOmitsFeedbackSectionWhenEmpty(t *testing.T) {
	batch := []storyTabMaterial{{GroupIndex: 1, Body: "Story 1\n主题：测试"}}
	prompt := buildStoryTabsPrompt(batch, nil)
	if strings.Contains(prompt, "需要修正的 Story") {
		t.Fatalf("prompt should not contain feedback section when none provided:\n%s", prompt)
	}
}

func TestRetryAndKeepBestTabsDoesNotRegress(t *testing.T) {
	// 重试返回优质 Tabs，应被采纳。验证重试确实发生且结果被写入。
	var callCount int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		callCount++
		writer.Header().Set("Content-Type", "application/json")
		// 重试总是返回 2 个合格 Tab。
		payload := `[{"group_index":1,"tabs":[` +
			`{"title":"事件概览","summary":"这是一段足够长的摘要内容用于通过字数校验。","subtitle":"GLM-5.2 已开启 Max 用户小范围内测，具体参数仍待公布。","kind":"fact","evidence_indexes":[1]},` +
			`{"title":"后续观察","summary":"这是另一段足够长的摘要内容用于通过字数校验。","subtitle":"具体上线范围与定价仍待智谱正式公布后确认。","kind":"watch","evidence_indexes":[1]}` +
			`]}]`
		_, _ = writer.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + jsonQuote(payload) + `}}]}`))
	}))
	defer server.Close()

	ai := AIConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test-model"}
	// 当前 0 个有效 Tab，触发重试。
	groups := []NewsGroup{{Title: "测试 Story", SourceIndexes: []int{1}}}
	groups[0].lastRejected = []rejectedTab{{Tab: StoryTab{Title: "", Summary: "短"}, Reason: "Tab 标题为空"}}

	calls := retryAndKeepBestTabs(ai, groups, []storyTabMaterial{{GroupIndex: 1, Body: "Story 1\n主题：测试"}}, map[int][]string{1: {"Tab 标题为空"}})

	if callCount != 1 || calls != 1 {
		t.Fatalf("expected exactly 1 retry call (success stops further retries), got server=%d returned=%d", callCount, calls)
	}
	if len(groups[0].Tabs) < minStoryTabs {
		t.Fatalf("after retry, tabs count = %d, want >= %d", len(groups[0].Tabs), minStoryTabs)
	}
}

func TestRetryAndKeepBestTabsKeepsCurrentWhenNotImproved(t *testing.T) {
	// 重试返回更差的 Tabs，应保留当前已有的。
	var callCount int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		callCount++
		writer.Header().Set("Content-Type", "application/json")
		// 重试全部不合格。
		payload := `[{"group_index":1,"tabs":[{"title":"","summary":"短"}]}]`
		_, _ = writer.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + jsonQuote(payload) + `}}]}`))
	}))
	defer server.Close()

	ai := AIConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test-model"}
	// 当前已有 1 个合格 Tab，重试不应让它变少。
	groups := []NewsGroup{{
		Title:         "测试 Story",
		SourceIndexes: []int{1},
		Tabs: []StoryTab{{
			Title:    "已有 Tab",
			Summary:  "这是一段足够长的摘要内容用于通过字数校验。",
			Subtitle: "GLM-5.2 已开启 Max 用户小范围内测，具体参数仍待公布。",
		}},
	}}
	groups[0].lastRejected = []rejectedTab{{Tab: StoryTab{Title: "", Summary: "短"}, Reason: "Tab 标题为空"}}

	retryAndKeepBestTabs(ai, groups, []storyTabMaterial{{GroupIndex: 1, Body: "Story 1\n主题：测试"}}, map[int][]string{1: {"Tab 标题为空"}})

	if len(groups[0].Tabs) != 1 || groups[0].Tabs[0].Title != "已有 Tab" {
		t.Fatalf("retry regressed existing tabs: %#v", groups[0].Tabs)
	}
	if callCount != 1 {
		t.Fatalf("retry calls = %d, want 1 when first retry did not improve quality", callCount)
	}
}

func TestCollectStoryTabQualityStats(t *testing.T) {
	groups := []NewsGroup{
		{
			Tabs: []StoryTab{
				{subtitleFallback: true},
				{},
			},
			lastRejected: []rejectedTab{{Reason: "evidence_indexes 未包含该 Story 的有效来源序号"}},
		},
		{Tabs: []StoryTab{{}}},
	}
	stats := collectStoryTabQualityStats(groups)
	if stats.acceptedTabs != 3 || stats.subtitleFallbacks != 1 ||
		stats.evidenceRejections != 1 || stats.fallbackStories != 1 {
		t.Fatalf("collectStoryTabQualityStats() = %#v", stats)
	}
}

// jsonQuote 把字符串编码为合法的 JSON 字符串字面量（含外层引号）。
func jsonQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
