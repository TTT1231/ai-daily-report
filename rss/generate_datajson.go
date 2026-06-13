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

type DataJSON struct {
	Schema  string          `json:"$schema"`
	Theme   string          `json:"theme"`
	Date    string          `json:"date"`
	Stories []DataJSONStory `json:"stories"`
}

type DataJSONStory struct {
	ID           string          `json:"id"`
	TopTitle     string          `json:"topTitle"`
	BottomTitle  string          `json:"bottomTitle"`
	ContentTitle string          `json:"contentTitle"`
	IntroTitle   string          `json:"introTitle,omitempty"`
	ActiveTab    string          `json:"activeTab,omitempty"`
	ActiveIntro  bool            `json:"activeIntro,omitempty"`
	Tabs         []DataJSONTab   `json:"tabs"`
	Scenes       []DataJSONScene `json:"scenes"`
}

type DataJSONTab struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

type DataJSONScene struct {
	ID       string `json:"id"`
	Subtitle string `json:"subtitle"`
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
		Schema: "../data-schema.json",
		Theme:  reportTheme(now),
		Date:   now.Format("2006-01-02"),
	}

	usedIDs := make(map[string]int)
	for i, group := range groups {
		if len(group.Tabs) < minStoryTabs {
			return fmt.Errorf("Story %q 只有 %d 个 Tabs，至少需要 %d 个", group.Title, len(group.Tabs), minStoryTabs)
		}
		storyID := uniqueStoryID(storyID(group, items), usedIDs)
		story := DataJSONStory{
			ID:           storyID,
			TopTitle:     truncateRunes(storyCategory(group), maxTopTitleRunes),
			BottomTitle:  navigationTitle(group),
			ContentTitle: truncateRunes(group.Title, maxContentTitleRunes),
			IntroTitle:   strings.TrimSpace(group.Title),
			ActiveIntro:  i == 0,
		}
		for tabIndex, tab := range group.Tabs {
			tabID := fmt.Sprintf("%s-tab-%d", storyID, tabIndex+1)
			story.Tabs = append(story.Tabs, DataJSONTab{
				ID:      tabID,
				Title:   tab.Title,
				Summary: tab.Summary,
			})
			story.Scenes = append(story.Scenes, DataJSONScene{
				ID:       fmt.Sprintf("%s-scene-%d", storyID, tabIndex+1),
				Subtitle: sceneSubtitle(tab),
			})
		}
		story.ActiveTab = preferredActiveTab(story.Tabs)
		report.Stories = append(report.Stories, story)
	}
	topSegments := topTitleSegmentCount(report.Stories)
	if len(report.Stories)-topSegments > maxTopBottomSegmentGap {
		return fmt.Errorf(
			"顶部栏目聚合过深：%d 个 Story 仅形成 %d 个相邻 topTitle 分段，差值不得超过 %d",
			len(report.Stories),
			topSegments,
			maxTopBottomSegmentGap,
		)
	}

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("编码 data.json 失败: %w", err)
	}
	data = append(data, '\n')

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("创建 data.json 目录失败: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("写入 data.json 失败: %w", err)
	}
	return nil
}

func topTitleSegmentCount(stories []DataJSONStory) int {
	segments := 0
	previous := ""
	for _, story := range stories {
		if story.TopTitle != previous {
			segments++
			previous = story.TopTitle
		}
	}
	return segments
}

// preferredActiveTab 选出视频默认激活的 Tab：Tab 数<=2 时不指定，否则用第二个（视觉居中位置）。
func preferredActiveTab(tabs []DataJSONTab) string {
	if len(tabs) <= 2 {
		return ""
	}
	return tabs[1].ID
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

// navigationTitle 生成底部时间线用的 3-5 字短标题：优先校验模型给出的，否则按品牌/事件关键词推断，再退到截断标题。
func navigationTitle(group NewsGroup) string {
	if title := validNavigationTitle(group.NavigationTitle); title != "" {
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
		return "克劳德动态"
	case containsAny(lower, "deepseek", "深度求索"):
		return "深度求索"
	case containsAny(lower, "qwen", "qween", "通义千问"):
		return "通义动态"
	case containsAny(lower, "gpt") && containsAny(lower, "封号", "被封", "杀号"):
		return "GPT封号"
	case containsAny(lower, "gpt"):
		return "GPT动态"
	}

	title := truncateRunes(strings.TrimSpace(group.Title), maxBottomTitleRunes)
	if valid := validNavigationTitle(title); valid != "" {
		return valid
	}
	return "AI动态"
}

// validNavigationTitle 校验短标题长度是否在允许区间，合格返回原值，否则返回空串表示不可用。
func validNavigationTitle(title string) string {
	title = strings.TrimSpace(title)
	length := len([]rune(title))
	if length < minNavigationTitleRunes || length > maxBottomTitleRunes {
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
