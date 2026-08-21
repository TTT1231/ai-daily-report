package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var validIdentifier = regexp.MustCompile(`^[a-z0-9][a-z0-9-.]*$`)

var (
	forumBracketRe = regexp.MustCompile(`^【[^】]*】\s*`)
	forumSaluteRe  = regexp.MustCompile(`^各位佬[，,]?\s*|^佬们?[，,]?\s*`)
	forumNewsRe    = regexp.MustCompile(`^(?:快讯|慢讯)[：:]\s*`)
	forumNarrateRe = regexp.MustCompile(`^(?:详细)?对比了一下\s*`)
	forumMetaRe    = regexp.MustCompile(`省流|长文总结|博客长文|个人省流`)
	forumArrowRe   = regexp.MustCompile(`→`)
	repeatBangRe   = regexp.MustCompile(`！{2,}`)
	repeatQuestRe  = regexp.MustCompile(`？{2,}`)
)

type DataJSON struct {
	Schema  string          `json:"$schema"`
	Theme   string          `json:"theme"`
	Date    string          `json:"date"`
	Stories []DataJSONStory `json:"stories"`
}

type DataJSONStory struct {
	ID               string          `json:"id"`
	TopTitle         string          `json:"topTitle"`
	BottomTitle      string          `json:"bottomTitle"`
	ContentTitle     string          `json:"contentTitle"`
	IntroTitle       string          `json:"introTitle,omitempty"`
	ActiveTab        string          `json:"activeTab,omitempty"`
	ActiveIntro      bool            `json:"activeIntro,omitempty"`
	Tabs             []DataJSONTab   `json:"tabs"`
	Scenes           []DataJSONScene `json:"scenes"`
	sourceGroupIndex int             `json:"-"` // 本 Story 来自 groups 的下标，供 vision-off 候选图下载定位证据来源
}

type DataJSONTab struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

type DataJSONScene struct {
	ID              string  `json:"id"`
	Subtitle        string  `json:"subtitle"`
	OverlayImg      string  `json:"overlayImg,omitempty"`
	OverlayImgScale float64 `json:"overlayImgScale,omitempty"`
}

// defaultDataJSONPath 确定 data.json 输出路径：优先用 REPORT_DATA_PATH 环境变量，否则用项目根目录下的 data-scheme/data.json。
func defaultDataJSONPath() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("REPORT_DATA_PATH")); configured != "" {
		return filepath.Abs(configured)
	}
	root, err := projectRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "data-scheme", "data.json"), nil
}

// generateDataJSON 把 Story 编排并写成 Remotion 可读的 data.json。
func generateDataJSON(path string, groups []NewsGroup, items []Item) error {
	if len(groups) == 0 {
		return fmt.Errorf("没有可写入的 Story")
	}

	now := time.Now()
	report := DataJSON{
		Schema: "../config/data.schema.json",
		Theme:  reportTheme(now),
		Date:   now.Format("2006-01-02"),
	}

	usedIDs := make(map[string]int)
	for i, group := range groups {
		if len(group.Tabs) < minStoryTabs {
			return fmt.Errorf("Story %q 只有 %d 个 Tabs，至少需要 %d 个", group.Title, len(group.Tabs), minStoryTabs)
		}
		if len(group.Scenes) < 1 || len(group.Scenes) > maxStoryScenes {
			return fmt.Errorf("Story %q 有 %d 个 Scenes，必须是 1 至 %d 个 Story 级精简口播", group.Title, len(group.Scenes), maxStoryScenes)
		}
		contentTitle := resolvedContentTitle(group)
		if contentTitle == "" {
			return fmt.Errorf("Story %q 没有语义完整且不超过 %d 字的 contentTitle；禁止用省略号截断", group.Title, maxContentTitleRunes)
		}
		bottomTitle := navigationTitle(group)
		storyID := uniqueStoryID(storyID(group, items), usedIDs)
		displayTitle := cleanDisplayTitle(group.Title)
		story := DataJSONStory{
			ID:               storyID,
			TopTitle:         storyCategory(group),
			BottomTitle:      bottomTitle,
			ContentTitle:     contentTitle,
			IntroTitle:       displayTitle,
			ActiveIntro:      i == 0,
			sourceGroupIndex: i,
		}
		for tabIndex, tab := range group.Tabs {
			tabID := fmt.Sprintf("%s-tab-%d", storyID, tabIndex+1)
			story.Tabs = append(story.Tabs, DataJSONTab{
				ID:      tabID,
				Title:   tab.Title,
				Summary: tab.Summary,
			})
		}
		usedImages := make(map[string]bool)
		for sceneIndex, sourceScene := range group.Scenes {
			scene := DataJSONScene{
				ID:       fmt.Sprintf("%s-scene-%d", storyID, sceneIndex+1),
				Subtitle: sourceScene.Subtitle,
			}
			if overlay := overlayImageForEvidence(group, sourceScene.EvidenceIndexes, usedImages); overlay.Path != "" {
				scene.OverlayImg = overlay.Path
			}
			story.Scenes = append(story.Scenes, scene)
		}
		story.ActiveTab = preferredActiveTab(story.Tabs)
		report.Stories = append(report.Stories, story)
	}
	report.Stories = compactStoriesByTopTitle(report.Stories)
	markActiveIntroStory(report.Stories)
	layout, err := loadNavigationLayout()
	if err != nil {
		return fmt.Errorf("加载导航布局失败: %w", err)
	}
	if err := fitNavigationLabels(report.Stories, layout); err != nil {
		return err
	}
	if splitTitle := splitTopTitleSegmentLabel(report.Stories); splitTitle != "" {
		return fmt.Errorf("顶部栏目 %q 出现多个非连续分段，请将同类 Story 放在一起", splitTitle)
	}

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("编码 data.json 失败: %w", err)
	}
	data = append(data, '\n')

	if err := writeFileAtomic(path, data, 0o755, 0o644); err != nil {
		return fmt.Errorf("写入 data.json 失败: %w", err)
	}

	if !readBoolEnv("CLAUDE_VISION_ENABLED", true) {
		root, rootErr := projectRoot()
		switch {
		case rootErr != nil:
			fmt.Printf("   ⚠️  警告：无法定位项目根目录，跳过候选图下载：%v\n", rootErr)
		default:
			client := newHTTPClient(defaultFeedRequestTimeout, false, true)
			if err := downloadManualCandidateImages(client, report, groups, items, root); err != nil {
				fmt.Printf("   ⚠️  警告：候选图下载失败（不影响 data.json）：%v\n", err)
			}
		}
	}

	return nil
}

// stripForumDecorations 剥离 linuxdo 等论坛源的口语/装饰：前缀【】、各位佬/佬们称呼、
// 省流/长文总结等元描述、→ 箭头、以及连续重复的！？。作为 LLM 标题清洗的确定性兜底。
func stripForumDecorations(title string) string {
	for _, re := range []*regexp.Regexp{forumBracketRe, forumSaluteRe, forumNewsRe, forumNarrateRe} {
		title = re.ReplaceAllString(title, "")
	}
	title = forumMetaRe.ReplaceAllString(title, "")
	title = forumArrowRe.ReplaceAllString(title, "")
	title = repeatBangRe.ReplaceAllString(title, "！")
	title = repeatQuestRe.ReplaceAllString(title, "？")
	return strings.TrimSpace(title)
}

func cleanDisplayTitle(title string) string {
	title = strings.TrimSpace(title)
	cleaned := strings.TrimRight(title, " \t\r\n?？。.!！")
	if cleaned == "" {
		return title
	}
	return stripForumDecorations(cleaned)
}

// cleanContentTitle 校验播放区主标题。能完整放下的原标题可以直接复用；超长
// 原标题必须由模型语义改写，这里绝不裁切字符串。接近 30 字上限且只是超长
// 原标题前缀的候选通常是机械截断，也会拒绝。
func cleanContentTitle(candidate, original string) string {
	title := cleanDisplayTitle(candidate)
	if title == "" || utf8.RuneCountInString(title) > maxContentTitleRunes ||
		strings.Contains(title, "…") || strings.Contains(title, "...") {
		return ""
	}
	for _, suffix := range []string{"以及", "并且", "而且", "由于", "因为", "与", "和", "及", "的", "、", "，", ",", "：", ":"} {
		if strings.HasSuffix(title, suffix) {
			return ""
		}
	}

	original = cleanDisplayTitle(original)
	if utf8.RuneCountInString(original) > maxContentTitleRunes &&
		utf8.RuneCountInString(title) >= maxContentTitleRunes-2 &&
		strings.HasPrefix(normalizeTitle(original), normalizeTitle(title)) {
		return ""
	}
	return title
}

func resolvedContentTitle(group NewsGroup) string {
	// 短原标题优先，避免模型为了“优化”而无谓改写。只有原标题放不下或本身
	// 不完整时，才采用模型生成的语义压缩标题。
	if title := cleanContentTitle(group.Title, group.Title); title != "" {
		return title
	}
	return cleanContentTitle(group.ContentTitle, group.Title)
}

func compactStoriesByTopTitle(stories []DataJSONStory) []DataJSONStory {
	if len(stories) <= 1 {
		return stories
	}
	grouped := make(map[string][]DataJSONStory, len(stories))
	order := make([]string, 0, len(stories))
	for _, story := range stories {
		if _, ok := grouped[story.TopTitle]; !ok {
			order = append(order, story.TopTitle)
		}
		grouped[story.TopTitle] = append(grouped[story.TopTitle], story)
	}
	if len(order) == len(stories) {
		return stories
	}
	compacted := make([]DataJSONStory, 0, len(stories))
	for _, topTitle := range order {
		compacted = append(compacted, grouped[topTitle]...)
	}
	return compacted
}

func markActiveIntroStory(stories []DataJSONStory) {
	for index := range stories {
		stories[index].ActiveIntro = index == 0
	}
}

func splitTopTitleSegmentLabel(stories []DataJSONStory) string {
	seen := make(map[string]bool, len(stories))
	previous := ""
	for _, story := range stories {
		if story.TopTitle != previous {
			if seen[story.TopTitle] {
				return story.TopTitle
			}
			seen[story.TopTitle] = true
			previous = story.TopTitle
		}
	}
	return ""
}

// preferredActiveTab 选出视频默认激活的 Tab：Tab 数<=2 时不指定，否则用第二个（视觉居中位置）。
func preferredActiveTab(tabs []DataJSONTab) string {
	if len(tabs) <= 2 {
		return ""
	}
	return tabs[1].ID
}

// overlayImageForEvidence conservatively maps downloaded source images to the
// small Story-level Scene set: an image is inserted only when its source supports the Scene and it has
// not already appeared in this Story.
func overlayImageForEvidence(group NewsGroup, evidenceIndexes []int, used map[string]bool) StoryImage {
	if len(group.ImageAssets) == 0 || len(evidenceIndexes) == 0 {
		return StoryImage{}
	}
	evidence := make(map[int]bool, len(evidenceIndexes))
	for _, index := range evidenceIndexes {
		evidence[index] = true
	}
	for _, image := range group.ImageAssets {
		if image.Path == "" || used[image.Path] || !evidence[image.SourceIndex] {
			continue
		}
		used[image.Path] = true
		return image
	}
	return StoryImage{}
}

// reportTheme 根据当前小时返回日报主题：白天（6-18 点）用 light，其余用 dark。
func reportTheme(now time.Time) string {
	if now.Hour() >= 6 && now.Hour() < 18 {
		return "light"
	}
	return "dark"
}

// storyID 为 Story 生成符合标识符规则的稳定 ID：优先用聚类身份键，其次来源稳定 ID 或来源指纹，最后兜底哈希。
func storyID(group NewsGroup, items []Item) string {
	for _, highlight := range group.Highlights {
		if highlight.Index < 1 || highlight.Index > len(items) {
			continue
		}
		key, _ := fallbackGroupIdentity(items[highlight.Index-1].Title)
		key = strings.ToLower(key)
		if validIdentifier.MatchString(key) {
			return key
		}
	}
	for _, index := range group.SourceIndexes {
		if index < 1 || index > len(items) {
			continue
		}
		item := items[index-1]
		if validIdentifier.MatchString(item.StableID) {
			return item.StableID
		}
		return sourceStoryID(item)
	}

	key, _ := fallbackGroupIdentity(group.Title)
	key = strings.ToLower(key)
	if validIdentifier.MatchString(key) {
		return key
	}
	hash := sha256.Sum256([]byte(group.Title))
	return "story-" + hex.EncodeToString(hash[:])[:10]
}

// sourceStoryID 用来源 ID 与条目指纹拼出通用来源型 Story ID。
func sourceStoryID(item Item) string {
	sourceID := sanitizeIdentifier(item.SourceID)
	if sourceID == "" {
		sourceID = "source"
	}
	return sourceID + "-" + itemFingerprint(item)[:10]
}

// sanitizeIdentifier 把任意字符串清洗为只含小写字母、数字与短横的合法标识符片段。
func sanitizeIdentifier(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var result strings.Builder
	lastDash := false
	for _, r := range value {
		valid := r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.'
		if valid {
			result.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && result.Len() > 0 {
			result.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(result.String(), "-")
}

// uniqueStoryID 在同一批 Story 内保证 ID 唯一：base 首次使用时原样返回，重复时追加序号后缀。
func uniqueStoryID(base string, used map[string]int) string {
	used[base]++
	if used[base] == 1 {
		return base
	}
	return fmt.Sprintf("%s-%d", base, used[base])
}

// storyCategory 按标题与理由的关键词判定 Story 的顶部分类标签（AI监管/模型产品/额度价格/账号风险/行业动态）。
func storyCategory(group NewsGroup) string {
	title := strings.ToLower(group.Title)
	text := strings.ToLower(group.Title + " " + group.Reason)
	switch {
	case containsAny(text, "网信办", "监管行动", "清朗", "举报专区", "专项行动", "合规治理", "执法"):
		return "AI监管"
	case containsAny(title, "额度", "限额", "重置", "价格", "涨价", "降价", "消耗", "倍率", "套餐") &&
		!containsAny(title, "开源", "内测", "上线", "模型"):
		return "额度价格"
	case containsAny(text, "封号", "被封", "风控", "杀号", "账号", "跑路", "诈骗"):
		return "账号风险"
	case containsAny(text, "开源", "模型", "内测", "api", "开发者模式", "浏览器模式",
		"openai", "anthropic", "deepseek", "chatgpt", "claude", "qwen", "kimi", "gemini", "minimax", "glm-", "gpt-"):
		return "模型产品"
	case containsAny(text, "额度", "限额", "重置", "价格", "涨价", "降价", "消耗", "倍率", "套餐"):
		return "额度价格"
	default:
		return "行业动态"
	}
}

// resolvedNavigationTitle 生成可完整显示的底部时间线语义标签：优先使用模型给出的
// 短标签，其次使用少量确定性品牌/事件规则。它绝不裁切字符串或添加省略号。
func resolvedNavigationTitle(group NewsGroup) string {
	if title := cleanNavigationTitle(group.NavigationTitle); title != "" &&
		normalizeTitle(title) != normalizeTitle(group.Title) {
		return title
	}

	lower := strings.ToLower(group.Title + " " + group.Reason)
	switch {
	case containsAny(lower, "清朗", "举报专区", "监管行动"):
		return "AI清朗"
	case containsAny(lower, "ona") && containsAny(lower, "收购", "并购"):
		return "Ona收购"
	case containsAny(lower, "codex") && containsAny(lower, "重置", "额度", "限额"):
		return "额度重置"
	case containsAny(lower, "codex") && containsAny(lower, "浏览器", "cdp", "browser"):
		return "浏览调试"
	case containsAny(lower, "kimi", "月之暗面") && containsAny(lower, "信用卡", "银行卡"):
		return "Kimi卡"
	case containsAny(lower, "kimi", "月之暗面") && containsAny(lower, "k2.7", "2.7"):
		return "K2.7"
	case containsAny(lower, "kimi", "月之暗面"):
		return "Kimi"
	case containsAny(lower, "智谱", "glm") && containsAny(lower, "消耗", "倍率", "内测"):
		return "智谱内测"
	case containsAny(lower, "智谱", "glm"):
		return "GLM动态"
	case containsAny(lower, "claude", "anthropic") && containsAny(lower, "封号", "被封", "账号"):
		return "克劳德封号"
	case containsAny(lower, "claude", "anthropic"):
		return "Claude"
	case containsAny(lower, "deepseek", "深度求索"):
		return "深度求索"
	case containsAny(lower, "qwen", "qween", "通义千问"):
		return "通义动态"
	case containsAny(lower, "gpt") && containsAny(lower, "封号", "被封", "杀号"):
		return "GPT封号"
	case containsAny(lower, "gpt"):
		return "GPT动态"
	}

	title := strings.TrimSpace(group.Title)
	if valid := cleanNavigationTitle(title); valid != "" {
		return valid
	}
	return ""
}

// navigationTitle 保留为生成与测试侧的统一入口。正常流水线在 Story Tabs 阶段要求
// navigation_title 通过严格短标签质量闸；通用兜底只服务于不经过该阶段的旧调用方。
func navigationTitle(group NewsGroup) string {
	if title := resolvedNavigationTitle(group); title != "" {
		return title
	}
	return "AI动态"
}

// validNavigationTitle 校验短标签可以原样完整显示。中文按 1 单位、ASCII 按 0.62
// 单位近似渲染宽度；超过上限必须让模型语义改写，不能交给布局层硬截断。
func validNavigationTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" || strings.Contains(title, "…") || strings.Contains(title, "...") {
		return ""
	}
	units := 0.0
	for _, r := range title {
		if r <= 0xff {
			units += 0.62
		} else {
			units++
		}
	}
	if units > maxNavigationTitleUnits {
		return ""
	}
	return title
}
