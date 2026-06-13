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

type ReportData struct {
	Schema  string        `json:"$schema"`
	Theme   string        `json:"theme"`
	Date    string        `json:"date"`
	Stories []ReportStory `json:"stories"`
}

type ReportStory struct {
	ID           string        `json:"id"`
	TopTitle     string        `json:"topTitle"`
	BottomTitle  string        `json:"bottomTitle"`
	ContentTitle string        `json:"contentTitle"`
	IntroTitle   string        `json:"introTitle,omitempty"`
	ActiveTab    string        `json:"activeTab,omitempty"`
	ActiveIntro  bool          `json:"activeIntro,omitempty"`
	Tabs         []ReportTab   `json:"tabs"`
	Scenes       []ReportScene `json:"scenes"`
}

type ReportTab struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

type ReportScene struct {
	ID       string `json:"id"`
	Subtitle string `json:"subtitle"`
}

func defaultReportDataPath() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("REPORT_DATA_PATH")); configured != "" {
		return filepath.Abs(configured)
	}
	root, err := projectRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "data-scheme", "data.json"), nil
}

func writeReportData(path string, groups []NewsGroup, items []Item) error {
	if len(groups) == 0 {
		return fmt.Errorf("没有可写入的 Story")
	}

	now := time.Now()
	report := ReportData{
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
		story := ReportStory{
			ID:           storyID,
			TopTitle:     truncateRunes(storyCategory(group), maxTopTitleRunes),
			BottomTitle:  navigationTitle(group),
			ContentTitle: truncateRunes(group.Title, maxContentTitleRunes),
			IntroTitle:   strings.TrimSpace(group.Title),
			ActiveIntro:  i == 0,
		}
		for tabIndex, tab := range group.Tabs {
			tabID := fmt.Sprintf("%s-tab-%d", storyID, tabIndex+1)
			story.Tabs = append(story.Tabs, ReportTab{
				ID:      tabID,
				Title:   tab.Title,
				Summary: tab.Summary,
			})
			story.Scenes = append(story.Scenes, ReportScene{
				ID:       fmt.Sprintf("%s-scene-%d", storyID, tabIndex+1),
				Subtitle: sceneSubtitle(tab),
			})
		}
		story.ActiveTab = preferredActiveTab(story.Tabs)
		report.Stories = append(report.Stories, story)
	}

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("编码 data.json 失败: %w", err)
	}
	data = append(data, '\n')

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("创建 data.json 目录失败: %w", err)
	}
	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, data, 0o644); err != nil {
		return fmt.Errorf("写入临时 data.json 失败: %w", err)
	}
	if err := replaceFile(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("替换 data.json 失败: %w", err)
	}
	return nil
}

func preferredActiveTab(tabs []ReportTab) string {
	if len(tabs) <= 2 {
		return ""
	}
	return tabs[1].ID
}

func replaceFile(tempPath, targetPath string) error {
	backupPath := targetPath + ".bak"
	_ = os.Remove(backupPath)

	if _, err := os.Stat(targetPath); err == nil {
		if err := os.Rename(targetPath, backupPath); err != nil {
			return err
		}
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Rename(backupPath, targetPath)
		return err
	}
	_ = os.Remove(backupPath)
	return nil
}

func reportTheme(now time.Time) string {
	if now.Hour() >= 6 && now.Hour() < 18 {
		return "light"
	}
	return "dark"
}

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
		if topicID := linuxDoTopicID(items[index-1].Link); topicID != "" {
			return "topic-" + topicID
		}
	}

	key, _ := fallbackGroupIdentity(group.Title)
	key = strings.ToLower(key)
	if validIdentifier.MatchString(key) {
		return key
	}
	hash := sha256.Sum256([]byte(group.Title))
	return "story-" + hex.EncodeToString(hash[:])[:10]
}

func linuxDoTopicID(link string) string {
	const marker = "/t/topic/"
	position := strings.Index(link, marker)
	if position == -1 {
		return ""
	}
	remainder := link[position+len(marker):]
	if slash := strings.IndexByte(remainder, '/'); slash != -1 {
		remainder = remainder[:slash]
	}
	for _, r := range remainder {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return remainder
}

func uniqueStoryID(base string, used map[string]int) string {
	used[base]++
	if used[base] == 1 {
		return base
	}
	return fmt.Sprintf("%s-%d", base, used[base])
}

func storyCategory(group NewsGroup) string {
	text := strings.ToLower(group.Title + " " + group.Reason)
	switch {
	case containsAny(text, "网信办", "监管行动", "清朗", "举报专区", "专项行动", "合规治理", "执法"):
		return "AI监管"
	case containsAny(text, "发布", "开源", "模型", "内测", "api", "开发者模式", "浏览器模式"):
		return "模型产品"
	case containsAny(text, "额度", "限额", "重置", "价格", "涨价", "降价", "消耗", "倍率", "套餐"):
		return "额度价格"
	case containsAny(text, "封号", "被封", "风控", "杀号", "账号", "跑路", "诈骗"):
		return "账号风险"
	default:
		return "行业动态"
	}
}

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

func validNavigationTitle(title string) string {
	title = strings.TrimSpace(title)
	length := len([]rune(title))
	if length < minNavigationTitleRunes || length > maxBottomTitleRunes {
		return ""
	}
	return title
}

func sceneSubtitle(tab StoryTab) string {
	if subtitle := normalizeSceneSubtitle(tab.Subtitle); subtitle != "" {
		return subtitle
	}
	return fallbackTabSubtitle(tab)
}
