package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func testPreferences(t *testing.T) PreferencesConfig {
	t.Helper()
	root, err := projectRoot()
	if err != nil {
		t.Fatal(err)
	}
	preferences, err := loadPreferences(filepath.Join(root, defaultPreferencesPath))
	if err != nil {
		t.Fatal(err)
	}
	return preferences
}

func TestKeywordInterestScore(t *testing.T) {
	preferences := testPreferences(t)
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
			score, _ := keywordInterestScore(preferences, tt.title)
			if score != tt.wantScore {
				t.Fatalf("keywordInterestScore(%q) = %d, want %d", tt.title, score, tt.wantScore)
			}
		})
	}
}

func TestContainsAnyIgnoresEmptyPreferenceTerm(t *testing.T) {
	if containsAny("unrelated title", "") {
		t.Fatal("containsAny() matched an empty term")
	}
}

func TestPriorityEntityConfigChangesLocalRecall(t *testing.T) {
	preferences := testPreferences(t)
	preferences.PriorityEntities = []PriorityEntity{{
		Name:    "NewBrand",
		Aliases: []string{"newbrand"},
	}}
	if score, _ := keywordInterestScore(preferences, "NewBrand 发布新模型并开放 API"); score != 9 {
		t.Fatalf("configured priority entity score = %d, want 9", score)
	}
	if score, _ := keywordInterestScore(preferences, "OpenAI 发布新模型并开放 API"); score != 0 {
		t.Fatalf("removed priority entity score = %d, want 0", score)
	}
}

func TestDirectPriorityAndHardExcludeKeywords(t *testing.T) {
	preferences := testPreferences(t)
	preferences.Signals.PriorityKeywords = []string{"mcp"}
	if score, _ := keywordInterestScore(preferences, "MCP 新增远程工具调用规范"); score != 9 {
		t.Fatalf("direct priority keyword score = %d, want 9", score)
	}
	preferences.Dislikes.HardExclude = []string{"招聘"}
	if score, _ := keywordInterestScore(preferences, "OpenAI 发布 AI 招聘计划"); score != 0 {
		t.Fatalf("hard excluded keyword score = %d, want 0", score)
	}
}

func TestPassesDeterministicInterestGate(t *testing.T) {
	preferences := testPreferences(t)
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
		if got := passesDeterministicInterestGate(preferences, tt.title, tt.score); got != tt.want {
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

func TestStripHTML(t *testing.T) {
	got := stripHTML(`<p>智谱运维人员在群内表示，<strong>一倍消耗</strong>可能持续到九月底。</p><p>Max 用户开始内测。</p>`)
	if strings.Contains(got, "<") || !strings.Contains(got, "一倍消耗") || !strings.Contains(got, "Max 用户") {
		t.Fatalf("stripHTML() = %q", got)
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

func TestNormalizeScoredItemsUsesPreferenceThresholds(t *testing.T) {
	preferences := testPreferences(t)
	preferences.Thresholds.MinimumScore = 8
	preferences.Thresholds.MaximumCandidates = 1
	got := normalizeScoredItems(preferences, []ScoredItem{
		{Index: 1, Score: 7},
		{Index: 2, Score: 8},
		{Index: 3, Score: 10},
	})
	if len(got) != 1 || got[0].Index != 3 {
		t.Fatalf("normalizeScoredItems() = %#v", got)
	}
}

func TestApplyKeywordWeightsPrefersNewerItemOnTie(t *testing.T) {
	// 同分同关键词分时，新发布的条目应排在前面（稳定 tie-break），
	// 避免昨天的剩余条目挤掉今天的新内容（RSS 重构最小版的核心保证）。
	preferences := testPreferences(t)
	preferences.Thresholds.MinimumScore = 7
	preferences.Thresholds.MaximumCandidates = 10
	preferences.Signals.PriorityKeywords = []string{"alpha"}
	older := time.Date(2026, 6, 23, 9, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 6, 24, 9, 0, 0, 0, time.UTC)
	items := []Item{
		{ID: "old", SourceID: "s", Title: "alpha 旧", PublishedAt: older},
		{ID: "new", SourceID: "s", Title: "alpha 新", PublishedAt: newer},
	}
	scored := applyKeywordWeights(preferences, nil, items)
	if len(scored) != 2 {
		t.Fatalf("expected 2 scored items, got %d (%#v)", len(scored), scored)
	}
	if scored[0].Index != 2 {
		t.Fatalf("expected newer item (index 2) first on tie, got index %d (%#v)", scored[0].Index, scored)
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

func TestGenerateDataJSONStripsTrailingQuestionMarksFromDisplayTitles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	groups := []NewsGroup{{
		Title:         "OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？",
		Reason:        "论坛标题带问号时，视频标题应更像日报标题",
		SourceIndexes: []int{1},
		Highlights:    []NewsHighlight{{Index: 1, Point: "芯片发布"}},
		Tabs: []StoryTab{
			{Title: "事件概览", Summary: "OpenAI 发布自研芯片 Jalapeño。", Subtitle: "OpenAI 发布自研芯片 Jalapeño，面向大模型推理场景。"},
			{Title: "用户影响", Summary: "自研芯片可能影响推理成本。", Subtitle: "自研芯片未来可能影响推理成本和相关服务价格。"},
		},
	}}
	items := []Item{{Title: "OpenAI 发布首款自研 LLM 推理芯片 Jalapeño？？", Link: "https://linux.do/t/topic/2468202"}}

	if err := generateDataJSON(path, groups, items); err != nil {
		t.Fatalf("generateDataJSON() error = %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var report DataJSON
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	got := report.Stories[0]
	if got.ContentTitle != "OpenAI 发布首款自研 LLM 推理芯片 Jalapeño" {
		t.Fatalf("ContentTitle = %q", got.ContentTitle)
	}
	if got.IntroTitle != "OpenAI 发布首款自研 LLM 推理芯片 Jalapeño" {
		t.Fatalf("IntroTitle = %q", got.IntroTitle)
	}
}

func TestGenerateDataJSONAssignsOverlayImagesByEvidence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	groups := []NewsGroup{{
		Title:         "测试图片插入",
		Reason:        "验证图片只在相关 Scene 中出现",
		SourceIndexes: []int{1, 2},
		Highlights:    []NewsHighlight{{Index: 1, Point: "来源一"}, {Index: 2, Point: "来源二"}},
		ImageAssets: []StoryImage{
			{SourceIndex: 1, Path: "images/source-one.png"},
			{SourceIndex: 2, Path: "images/source-two.png"},
		},
		Tabs: []StoryTab{
			{Title: "第一张", Summary: "第一张图支撑的摘要内容。", EvidenceIndexes: []int{1}},
			{Title: "第二张", Summary: "第二张图支撑的摘要内容。", EvidenceIndexes: []int{1, 2}},
			{Title: "无图", Summary: "没有剩余图片时不要重复插入。", EvidenceIndexes: []int{2}},
		},
	}}
	items := []Item{
		{Title: "来源一", Link: "https://example.com/one"},
		{Title: "来源二", Link: "https://example.com/two"},
	}

	if err := generateDataJSON(path, groups, items); err != nil {
		t.Fatalf("generateDataJSON() error = %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var report DataJSON
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	scenes := report.Stories[0].Scenes
	if scenes[0].OverlayImg != "images/source-one.png" ||
		scenes[1].OverlayImg != "images/source-two.png" ||
		scenes[2].OverlayImg != "" {
		t.Fatalf("unexpected overlay assignment: %#v", scenes)
	}
}

func TestCompactStoriesByTopTitleKeepsSameCategoryContiguous(t *testing.T) {
	stories := []DataJSONStory{
		{ID: "model-1", TopTitle: "模型产品", ActiveIntro: true},
		{ID: "account-1", TopTitle: "账号风险"},
		{ID: "model-2", TopTitle: "模型产品"},
		{ID: "industry-1", TopTitle: "行业动态"},
		{ID: "account-2", TopTitle: "账号风险"},
	}
	got := compactStoriesByTopTitle(stories)
	ids := make([]string, 0, len(got))
	for _, story := range got {
		ids = append(ids, story.ID)
	}
	want := []string{"model-1", "model-2", "account-1", "account-2", "industry-1"}
	if strings.Join(ids, ",") != strings.Join(want, ",") {
		t.Fatalf("compactStoriesByTopTitle() ids = %#v, want %#v", ids, want)
	}
	if split := splitTopTitleSegmentLabel(got); split != "" {
		t.Fatalf("compacted stories still have split topTitle %q", split)
	}

	markActiveIntroStory(got)
	for index, story := range got {
		if story.ActiveIntro != (index == 0) {
			t.Fatalf("story %d activeIntro = %v", index, story.ActiveIntro)
		}
	}
}

func TestSplitTopTitleSegmentLabelDetectsRepeatedCategory(t *testing.T) {
	stories := []DataJSONStory{
		{TopTitle: "模型产品"},
		{TopTitle: "账号风险"},
		{TopTitle: "模型产品"},
	}
	if got := splitTopTitleSegmentLabel(stories); got != "模型产品" {
		t.Fatalf("splitTopTitleSegmentLabel() = %q, want 模型产品", got)
	}
}

func TestMigratedProjectPathsUseParentRoot(t *testing.T) {
	root, err := projectRoot()
	if err != nil {
		t.Fatal(err)
	}
	// projectRoot 的判据是存在 config/data.schema.json；basename 在 worktree 下不固定
	//（worktree 目录名可能是 test-xxx），故只校验 root 确实带标志文件，不再断言具体目录名，
	// 避免 worktree 假失败把 Go 套件挡在门禁外。
	if _, err := os.Stat(filepath.Join(root, "config", "data.schema.json")); err != nil {
		t.Fatalf("projectRoot() = %q 不含 config/data.schema.json: %v", root, err)
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
	if got != "额度重置" {
		t.Fatalf("navigationTitle() = %q, want 额度重置", got)
	}
}

func TestNavigationTitleAcceptsNarrowEnglishBrand(t *testing.T) {
	group := NewsGroup{
		Title:           "Claude 因服务不可用允许退款",
		NavigationTitle: "Claude",
	}
	if got := navigationTitle(group); got != "Claude" {
		t.Fatalf("navigationTitle() = %q, want Claude", got)
	}
}

func TestNavigationTitleAllowsLongerSuggestionForGlobalFitting(t *testing.T) {
	input := "Claude退款资格说明"
	if got := validNavigationTitle(input); got != input {
		t.Fatalf("validNavigationTitle() = %q, want %q", got, input)
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

func TestExtractRemoteImageURLsIgnoresOneboxPreviewImages(t *testing.T) {
	description := `<aside class="onebox allowlistedgeneric" data-onebox-src="https://docs.qoder.com/zh/events/offpeakrate">
  <header class="source">
    <img src="https://cdn3.ldstatic.com/original/4X/d/c/1/dc142bbe095a26f3c48f9c0379ce528c7eed1247.png" class="site-icon" width="192" height="192">
  </header>
  <article class="onebox-body">
    <div class="aspect-image"><img src="https://cdn3.ldstatic.com/optimized/4X/f/2/8/f28c8be8051f83590c002c867f56e81c3451a4a3_2_690x362.png" class="thumbnail" width="690" height="362"></div>
  </article>
</aside>`
	if got := extractRemoteImageURLs(description); len(got) != 0 {
		t.Fatalf("extractRemoteImageURLs() should ignore onebox images, got %#v", got)
	}
}

func TestExtractRemoteImageURLsIgnoresDivOnebox(t *testing.T) {
	// Discourse 也用 <div class="onebox"> 包装（不仅 <aside>），站点图标同样要被剔除。
	description := `<div class="onebox">
  <header class="source"><img src="https://cdn3.ldstatic.com/original/4X/d/c/1/dc142bbe.png" class="site-icon" width="192" height="192"></header>
</div>`
	if got := extractRemoteImageURLs(description); len(got) != 0 {
		t.Fatalf("extractRemoteImageURLs() should ignore div-based onebox images, got %#v", got)
	}
}

func TestExtractRemoteImageURLsIgnoresUnclosedOnebox(t *testing.T) {
	// 论坛 RSS 描述可能被截断，onebox 开标签未闭合：剥到字符串末尾，站点图标不漏入候选。
	description := `<aside class="onebox"><img src="https://cdn3.ldstatic.com/original/4X/d/c/1/dc142bbe.png" class="site-icon" width="192" height="192">`
	if got := extractRemoteImageURLs(description); len(got) != 0 {
		t.Fatalf("extractRemoteImageURLs() should ignore unclosed onebox images, got %#v", got)
	}
}

func TestExtractRemoteImageURLsKeepsArticleImageAlongsideOnebox(t *testing.T) {
	// onebox 被剥掉的同时，正文里的真实配图必须保留（防止误剥真图）。
	description := `<p>正文截图：<img src="https://example.com/article/evidence.png"></p>
<aside class="onebox"><img src="https://cdn3.ldstatic.com/original/4X/logo.png" class="site-icon"></aside>`
	got := extractRemoteImageURLs(description)
	if len(got) != 1 || got[0] != "https://example.com/article/evidence.png" {
		t.Fatalf("extractRemoteImageURLs() should keep the article image and drop only the onebox image, got %#v", got)
	}
}

func TestBuildClaudeVisionArgsUsesMCPAllowlist(t *testing.T) {
	args := buildClaudeVisionArgs("prompt", &VisionAnalyzer{maxBudgetUSD: "0.01"})
	joined := strings.Join(args, "\x00")
	if strings.Contains(joined, "dangerously") {
		t.Fatalf("Claude vision args must not bypass permissions: %#v", args)
	}
	// claude 的 allow 规则禁止裸 "mcp__*"（会 exit 1），必须用具名服务器 mcp__<server>__*。
	if strings.Contains(joined, "\x00mcp__*\x00") {
		t.Fatalf("Claude vision args must use a scoped mcp__<server>__* rule, not the bare invalid mcp__*: %#v", args)
	}
	if !strings.Contains(joined, "mcp__") || !strings.Contains(joined, "__*") {
		t.Fatalf("Claude vision args should allow a scoped MCP server (mcp__<server>__*), got %#v", args)
	}
	if !strings.Contains(joined, "WebFetch") {
		t.Fatalf("Claude vision args should allow WebFetch, got %#v", args)
	}
	if strings.Contains(joined, "\x00Bash") || strings.Contains(joined, "\x00Write") || strings.Contains(joined, "\x00Edit") {
		t.Fatalf("Claude vision args should not allow shell or file edits, got %#v", args)
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

func TestVisionAnalyzerShouldAnalyzeReportWorthyImageSource(t *testing.T) {
	analyzer := &VisionAnalyzer{enabled: true, maxCalls: 4}
	shortItem := Item{
		Title:       "Anthropic 禁用两款模型",
		Description: `<p>正文很短。</p><img src="https://cdn.example.com/image.png">`,
	}
	longItem := Item{
		Title:       "Anthropic 禁用两款模型",
		Description: `<p>` + strings.Repeat("正文较长。", 200) + `</p><img src="https://cdn.example.com/image.png">`,
	}
	// 进入日报的 Story（分数 >= visionMinStoryScore，即日报入选线 7）只要有远程图就识别，不看正文长短
	if !analyzer.shouldAnalyze(shortItem, NewsGroup{Score: 7}) {
		t.Fatal("report-worthy short item shouldAnalyze() = false, want true")
	}
	if !analyzer.shouldAnalyze(longItem, NewsGroup{Score: 9}) {
		t.Fatal("long item shouldAnalyze() = false, want true (text length no longer gates)")
	}
	// 低于日报入选线的 Story 不识别（门槛仍保留过滤作用）
	if analyzer.shouldAnalyze(shortItem, NewsGroup{Score: 6}) {
		t.Fatal("shouldAnalyze() accepted below-threshold source")
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
	got, err := linuxDoPageURL("https://linux.do/c/news/34.rss", 2)
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
	if item.CanonicalID != "linuxdo:topic:2386790" {
		t.Fatalf("adaptLinuxDoItem() CanonicalID = %q", item.CanonicalID)
	}
}

func TestLinuxDoTopicsDeduplicateAcrossConfiguredSources(t *testing.T) {
	items := []Item{
		{ID: "first-guid", SourceID: "linuxdo-news", CanonicalID: "linuxdo:topic:2386790"},
		{ID: "second-guid", SourceID: "linuxdo-other", CanonicalID: "linuxdo:topic:2386790"},
	}
	got := dedupeItems(items)
	if len(got) != 1 || got[0].SourceID != "linuxdo-news" {
		t.Fatalf("dedupeItems() = %#v", got)
	}
}

func TestLoadJSONCSourceAndPreferencesConfigs(t *testing.T) {
	root, err := projectRoot()
	if err != nil {
		t.Fatal(err)
	}
	sources, err := loadSources(filepath.Join(root, defaultSourcesPath))
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0].ID != "linuxdo-news" {
		t.Fatalf("loadSources() = %#v", sources)
	}
	preferences := testPreferences(t)
	if len(preferences.PriorityEntities) == 0 || preferences.Thresholds.MinimumScore != 7 {
		t.Fatalf("loadPreferences() = %#v", preferences)
	}
	prompt := buildNewsRankingSystemPrompt(preferences)
	if !strings.Contains(prompt, "Codex") || !strings.Contains(prompt, "限时优惠") {
		t.Fatalf("generated ranking prompt missing configured preferences: %s", prompt)
	}
}

func TestStripTrailingCommasToleratesJSONC(t *testing.T) {
	cases := map[string]string{
		"object trailing comma": `{"a":1,}`,
		"array trailing comma":  `{"a":[1,2,],}`,
		"comma before newline":  "{\n  \"a\": 1,\n}",
		"nested":                `{"a":{"b":[1,],},}`,
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			cleaned := stripTrailingCommas([]byte(in))
			var v map[string]any
			if err := json.Unmarshal(cleaned, &v); err != nil {
				t.Fatalf("json.Unmarshal(%s) failed: %v", cleaned, err)
			}
		})
	}
	// 字符串内的逗号+闭括号不能被误删
	src := `{"s":"a,]"}`
	cleaned := stripTrailingCommas([]byte(src))
	if string(cleaned) != src {
		t.Fatalf("stripTrailingCommas altered string content: got %s", cleaned)
	}
}

func TestValidatePreferencesRejectsEmptyAlias(t *testing.T) {
	preferences := testPreferences(t)
	preferences.PriorityEntities[0].Aliases = []string{""}
	if err := validatePreferences(preferences); err == nil {
		t.Fatal("validatePreferences() accepted empty alias")
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

func TestSaveRSSStateAtomicallyReplacesAndCleansStaleTemp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rss-state.json")

	if err := saveRSSState(path, snapshotRSSState([]Item{{ID: "old", SourceID: "s", Title: "旧"}})); err != nil {
		t.Fatalf("initial save error = %v", err)
	}
	// 模拟上一次写入被中途杀死后残留的临时文件。
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, []byte("partial"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := saveRSSState(path, snapshotRSSState([]Item{{ID: "new", SourceID: "s", Title: "新"}})); err != nil {
		t.Fatalf("overwrite save error = %v", err)
	}

	// 原子写：成功提交后临时文件不应残留。
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Fatalf("stale temp file still present after atomic save: %v", err)
	}
	loaded, err := loadRSSState(path)
	if err != nil {
		t.Fatalf("load error = %v", err)
	}
	if len(loaded.Items) != 1 {
		t.Fatalf("loaded %d items, want 1 (fresh state)", len(loaded.Items))
	}
}

func TestMergeRSSStatePreservesFailedSourceOnly(t *testing.T) {
	previous := snapshotRSSState([]Item{
		{ID: "old-a", SourceID: "source-a", Title: "旧 A"},
		{ID: "old-b", SourceID: "source-b", Title: "旧 B"},
	})
	next := mergeRSSState(
		[]Item{{ID: "new-a", SourceID: "source-a", Title: "新 A"}},
		previous,
		map[string]error{"source-b": fmt.Errorf("抓取失败")},
	)
	if len(next.Items) != 2 {
		t.Fatalf("mergeRSSState() contains %d items, want 2", len(next.Items))
	}
	if len(filterUnseenItems([]Item{{ID: "old-b", SourceID: "source-b"}}, next)) != 0 {
		t.Fatal("mergeRSSState() did not preserve failed source snapshot")
	}
	if len(filterUnseenItems([]Item{{ID: "old-a", SourceID: "source-a"}}, next)) != 1 {
		t.Fatal("mergeRSSState() did not replace successful source snapshot")
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

func TestCleanNavigationTitleRejectsMissingInformation(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
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

func TestCleanNavigationTitleKeepsLongerConcreteLabelForGlobalFitting(t *testing.T) {
	input := "Claude退款资格说明"
	if got := cleanNavigationTitle(input); got != input {
		t.Fatalf("cleanNavigationTitle(%q) = %q, want unchanged", input, got)
	}
}

func TestCleanNavigationTitleRejectsVacuousLabel(t *testing.T) {
	// 纯栏目名长度合规但无具体事件信息，应被清空，交给下游降级。
	vacuous := []string{"事件概览", "用户影响", "后续观察", "AI", "AI动态", "最新消息"}
	for _, input := range vacuous {
		if got := cleanNavigationTitle(input); got != "" {
			t.Fatalf("cleanNavigationTitle(%q) = %q, want empty", input, got)
		}
	}
}

func TestNavigationLayoutReservesComfortableSpacing(t *testing.T) {
	layout, err := loadNavigationLayout()
	if err != nil {
		t.Fatal(err)
	}
	labels := []string{"Intro", "Claude", "再见"}
	required := layout.requiredWidth(labels)
	bareMinimum := float64(len(labels)) * layout.MinimumItemWidth
	if required <= bareMinimum {
		t.Fatalf("required width = %.0f, want more than bare minimum %.0f for edges and gaps", required, bareMinimum)
	}
	if layout.storyCapacity()+2 != layout.comfortableItemCapacity() {
		t.Fatalf("story capacity = %d, item capacity = %d", layout.storyCapacity(), layout.comfortableItemCapacity())
	}
}

func TestFitNavigationLabelsKeepsLongLabelWhenThereIsRoom(t *testing.T) {
	layout, err := loadNavigationLayout()
	if err != nil {
		t.Fatal(err)
	}
	stories := []DataJSONStory{{
		TopTitle:    "模型产品与开发工具",
		BottomTitle: "Claude退款资格说明",
	}}
	fitNavigationLabels(stories, layout)
	if stories[0].BottomTitle != "Claude退款资格说明" {
		t.Fatalf("bottom title unexpectedly shortened to %q", stories[0].BottomTitle)
	}
	if stories[0].TopTitle != "模型产品与开发工具" {
		t.Fatalf("top title unexpectedly shortened to %q", stories[0].TopTitle)
	}
}

func TestFitNavigationLabelsShortensCrowdedNavigation(t *testing.T) {
	layout, err := loadNavigationLayout()
	if err != nil {
		t.Fatal(err)
	}
	stories := make([]DataJSONStory, maxGroups)
	for index := range stories {
		stories[index] = DataJSONStory{
			TopTitle:    fmt.Sprintf("很长的栏目名称%d", index),
			BottomTitle: fmt.Sprintf("Claude退款资格说明与处理范围%d", index),
		}
	}
	fitNavigationLabels(stories, layout)

	bottomLabels := []string{"Intro"}
	for _, story := range stories {
		bottomLabels = append(bottomLabels, story.BottomTitle)
	}
	bottomLabels = append(bottomLabels, "再见")
	if required := layout.requiredWidth(bottomLabels); required > float64(layout.VideoWidth) {
		t.Fatalf("bottom navigation requires %.0fpx after fitting, available %dpx", required, layout.VideoWidth)
	}
	if stories[0].BottomTitle == "Claude退款资格说明与处理范围0" {
		t.Fatalf("crowded navigation did not shorten any bottom titles")
	}
	if required := layout.requiredWidth(topNavigationLabels(stories)); required > float64(layout.VideoWidth) {
		t.Fatalf("top navigation requires %.0fpx after fitting, available %dpx", required, layout.VideoWidth)
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

func TestNormalizeSceneSubtitleAllowsConcreteFactWithUncertainty(t *testing.T) {
	for _, input := range []string{
		"GLM-5.2 已开启 Max 用户小范围内测，具体参数仍待公布。",
		"消息显示新模型可能即将公布，当前前端代码已经出现 5.6-preview 标识。",
		"OpenAI 已调整 Business 权益，关键变化已经列出，具体规则可查看官方文档。",
	} {
		if got := normalizeSceneSubtitle(input); got != input {
			t.Fatalf("normalizeSceneSubtitle(%q) = %q, want unchanged", input, got)
		}
	}
}

func TestNormalizeSceneSubtitleRejectsStandaloneUncertainty(t *testing.T) {
	for _, input := range []string{
		"OpenAI 尚未公布替代方案或过渡安排，生效日期和补偿措施有待官方明确。",
		"对于用户反映的 20 倍扣费问题，官方尚未直接回应，仅确认 Google Play 订阅服务故障，后续需等待进一步说明。",
		"服务中断原因及恢复时间尚未公布，用户需留意 Codex 状态更新或 OpenAI 官方说明。",
	} {
		if got := normalizeSceneSubtitle(input); got != "" {
			t.Fatalf("normalizeSceneSubtitle(%q) = %q, want empty", input, got)
		}
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
	// summary 超过卡片可承载的可见字符上限。
	if got := tabRejectionReason(StoryTab{
		Title:   "过长摘要",
		Summary: "DeepSeek V4 正式版计划于 **7 月中旬** 上线，将带来功能优化与性能提升。同时引入 **峰谷定价机制**：`deepseek-v4-pro` 和 `deepseek-v4-flash` 在高峰时段（每日 **9:00～12:00** 和 **14:00～18:00** 北京时间）价格翻倍。调整前 **24 小时** 会通过邮件通知用户，不同意可退出并退费。",
	}); got == "" {
		t.Fatalf("tabRejectionReason() for overlong summary should not be empty")
	}
	// 单独讲未知或等待官方确认，应拒绝。
	for _, tab := range []StoryTab{
		{
			Title:   "官方尚未公布替代方案",
			Summary: "OpenAI 未说明是否会为 Business 用户提供其他功能补偿，或是否有过渡期。具体替代方案和生效日期仍需官方进一步确认。",
		},
		{
			Title:   "20 倍扣费待核实",
			Summary: "用户反馈的 20 倍异常扣费问题尚未获得 OpenAI 明确说明，当前仅确认 Play 订阅不可用，具体扣费原因和金额仍需官方进一步回应。",
		},
		{
			Title:   "后续观察：谈判结果与模型上线",
			Summary: "需关注 Tom Brown 能否推动谈判进展，以及 Fable 5 模型的具体可用时间，目前官方尚未给出明确时间表。",
		},
	} {
		if got := tabRejectionReason(tab); got == "" {
			t.Fatalf("tabRejectionReason() for low-information uncertainty tab should not be empty: %#v", tab)
		}
	}
	// 合格返回空串。
	got := tabRejectionReason(StoryTab{
		Title:   "事件概览",
		Summary: "这是一段足够长的摘要内容用于通过字数校验，并说明具体影响。",
	})
	if got != "" {
		t.Fatalf("tabRejectionReason() for valid tab = %q, want empty", got)
	}
	got = tabRejectionReason(StoryTab{
		Title:   "Business 方案取消 Codex 席位",
		Summary: "OpenAI 更新文档，ChatGPT Business 方案将不再提供 Codex 席位，现有 Business 用户可能失去该功能，具体影响尚未明确。",
	})
	if got != "" {
		t.Fatalf("tabRejectionReason() rejected concrete tab with uncertainty qualifier: %q", got)
	}
	got = tabRejectionReason(StoryTab{
		Title:   "GLM-5.2 内测启动",
		Summary: "GLM-5.2 已开启 Max 用户小范围内测，具体参数仍待公布；这会影响高频用户是否提前准备迁移或测试。",
	})
	if got != "" {
		t.Fatalf("tabRejectionReason() rejected concrete tab with pending details: %q", got)
	}
	got = tabRejectionReason(StoryTab{
		Title:   "后续观察：Issue #123",
		Summary: "需关注 Issue #123 的修复状态；官方文档已列出当前规则，具体执行时间尚未给出明确时间表。",
	})
	if got != "" {
		t.Fatalf("tabRejectionReason() rejected concrete watch tab with anchor: %q", got)
	}
}

func TestNormalizeStoryTabsWithReasonsCapturesRejections(t *testing.T) {
	group := NewsGroup{SourceIndexes: []int{1}}
	tabs := []StoryTab{
		{Title: "完整标题", Summary: "这是一段足够长的摘要内容用于通过字数校验，并说明具体影响。", Subtitle: "GLM-5.2 已开启 Max 用户小范围内测，具体参数仍待公布。", EvidenceIndexes: []int{1}},
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
		Summary: "这是一段足够长但没有有效来源证据的摘要内容，用于测试证据校验。",
	}}
	normalized, rejected := normalizeStoryTabsWithReasons(group, tabs)
	if len(normalized) != 0 || len(rejected) != 1 {
		t.Fatalf("normalizeStoryTabsWithReasons() = %#v / %#v", normalized, rejected)
	}
	if !strings.Contains(rejected[0].Reason, "evidence_indexes") {
		t.Fatalf("rejection reason = %q, want evidence feedback", rejected[0].Reason)
	}
}

func TestBuildStoryTabsPromptHasNoFeedbackSection(t *testing.T) {
	batch := []storyTabMaterial{{GroupIndex: 1, Body: "Story 1\n主题：测试"}}
	prompt := buildStoryTabsPrompt(batch)
	if strings.Contains(prompt, "需要修正的 Story") {
		t.Fatalf("prompt should not contain feedback section:\n%s", prompt)
	}
}

func TestContainsAnyUsesWordBoundariesForASCIITerms(t *testing.T) {
	// 纯 ASCII 短词必须落在词边界上，避免子串误命中。
	if containsAny("digital capital mainstream chain", "ai", "api", "glm") {
		t.Fatal("containsAny() matched an ASCII term inside a larger word")
	}
	// 真正作为独立词出现时仍应命中（前后是空白）。
	if !containsAny("开放 api 与 gpt 模型", "api", "gpt") {
		t.Fatal("containsAny() missed a standalone ASCII term")
	}
	// CJK 词无词边界概念，仍走子串匹配。
	if !containsAny("网信办开设举报专区", "网信办") {
		t.Fatal("containsAny() dropped CJK substring matching")
	}
}

func TestRecoverScoredItemsHandlesMultilineObjects(t *testing.T) {
	// 模型美化输出：每个对象跨多行。旧版逐行恢复会返回 0 条，括号深度扫描应全部救回。
	content := `[
  {
    "index": 1,
    "title": "多行对象一",
    "score": 9,
    "reason": "重要"
  },
  {
    "index": 2,
    "title": "多行对象二",
    "score": 8,
    "reason": "次要"
  }
]`
	got := recoverScoredItems(content)
	if len(got) != 2 || got[0].Index != 1 || got[1].Index != 2 {
		t.Fatalf("recoverScoredItems() = %#v", got)
	}
}

// jsonQuote 把字符串编码为合法的 JSON 字符串字面量（含外层引号）。
func jsonQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
