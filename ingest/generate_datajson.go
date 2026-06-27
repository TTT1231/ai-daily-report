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
)

var validIdentifier = regexp.MustCompile(`^[a-z0-9][a-z0-9-.]*$`)

var (
	forumBracketRe = regexp.MustCompile(`^【[^】]*】\s*`)
	forumSaluteRe  = regexp.MustCompile(`^各位佬[，,]?\s*|^佬们?[，,]?\s*`)
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
		storyID := uniqueStoryID(storyID(group, items), usedIDs)
		displayTitle := cleanDisplayTitle(group.Title)
		story := DataJSONStory{
			ID:               storyID,
			TopTitle:         storyCategory(group),
			BottomTitle:      navigationTitle(group),
			ContentTitle:     truncateRunes(displayTitle, maxContentTitleRunes),
			IntroTitle:       displayTitle,
			ActiveIntro:      i == 0,
			sourceGroupIndex: i,
		}
		usedImages := make(map[string]bool)
		for tabIndex, tab := range group.Tabs {
			tabID := fmt.Sprintf("%s-tab-%d", storyID, tabIndex+1)
			story.Tabs = append(story.Tabs, DataJSONTab{
				ID:      tabID,
				Title:   tab.Title,
				Summary: tab.Summary,
			})
			scene := DataJSONScene{
				ID:       fmt.Sprintf("%s-scene-%d", storyID, tabIndex+1),
				Subtitle: sceneSubtitle(tab),
			}
			if overlay := overlayImageForTab(group, tab, usedImages); overlay.Path != "" {
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
	fitNavigationLabels(report.Stories, layout)
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
	for _, re := range []*regexp.Regexp{forumBracketRe, forumSaluteRe} {
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
	cleaned := strings.TrimRight(title, " \t\r\n?？")
	if cleaned == "" {
		return title
	}
	return stripForumDecorations(cleaned)
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

// overlayImageForTab conservatively maps downloaded source images to scenes:
// an image is inserted only when its source supports the current Tab and it has
// not already appeared in this Story.
func overlayImageForTab(group NewsGroup, tab StoryTab, used map[string]bool) StoryImage {
	if len(group.ImageAssets) == 0 || len(tab.EvidenceIndexes) == 0 {
		return StoryImage{}
	}
	evidence := make(map[int]bool, len(tab.EvidenceIndexes))
	for _, index := range tab.EvidenceIndexes {
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
		!containsAny(title, "发布", "开源", "内测", "上线", "模型"):
		return "额度价格"
	case containsAny(text, "封号", "被封", "风控", "杀号", "账号", "跑路", "诈骗"):
		return "账号风险"
	case containsAny(text, "发布", "开源", "模型", "内测", "api", "开发者模式", "浏览器模式"):
		return "模型产品"
	case containsAny(text, "额度", "限额", "重置", "价格", "涨价", "降价", "消耗", "倍率", "套餐"):
		return "额度价格"
	default:
		return "行业动态"
	}
}

// navigationTitle 生成底部时间线短标题：优先校验模型给出的，否则按品牌/事件关键词推断，再退到截断标题。
func navigationTitle(group NewsGroup) string {
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
	// bottomTitle 是必填字段；确实无法从 Story 推断时才使用通用最终兜底。
	return "AI动态"
}

// validNavigationTitle 只校验短标题非空；最终长度由整条导航的动态容量统一适配。
func validNavigationTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}
	return title
}

// sceneSubtitle 返回场景口播字幕：模型字幕校验通过即采用，否则从 Tab 内容兜底生成。
func sceneSubtitle(tab StoryTab) string {
	if subtitle := normalizeSceneSubtitle(tab.Subtitle); subtitle != "" {
		return subtitle
	}
	return fallbackTabSubtitle(tab)
}
