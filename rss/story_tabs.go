package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

func generateStoryTabs(apiKey string, groups []NewsGroup, items []Item) ([]NewsGroup, error) {
	vision := newVisionAnalyzer()
	var stories []string
	for i, group := range groups {
		var sources []string
		for _, index := range representativeSourceIndexes(group) {
			if index < 1 || index > len(items) {
				continue
			}
			item := items[index-1]
			visionMaterial := formatVisionMaterial(vision.analyzeItem(item, group))
			sources = append(sources, fmt.Sprintf(
				"来源 %d\n标题：%s\n首帖正文：%s%s",
				index, item.Title, itemSourceText(item), visionMaterial,
			))
		}
		stories = append(stories, fmt.Sprintf(
			`Story %d
主题：%s
重要性：%s
可引用来源序号：%v
%s`,
			i+1, group.Title, group.Reason, group.SourceIndexes, strings.Join(sources, "\n"),
		))
	}

	for start := 0; start < len(stories); start += storyTabBatchSize {
		end := min(start+storyTabBatchSize, len(stories))
		prompt := fmt.Sprintf(`请为以下 %d 个 Story 分别生成 %d 至 %d 个适合短视频展示的 Tabs。
每个 summary 至少 %d 个汉字。先完整覆盖来源中的独立事实，再决定 Tabs 数量；只有来源确实不超过两个独立事实时才使用两个 Tabs，不得虚构事实或用重复内容凑数。

严格返回以下 JSON，不要返回其他内容：
[
  {
    "group_index": Story 序号,
    "tabs": [
      {
        "title": "简短 Tab 标题",
        "summary": "至少二十个汉字的完整内容，主动使用粗体与行内代码 Markdown 突出重点",
        "subtitle": "28至96个汉字的完整新闻口播，包含主体、事件及范围或结果，禁止提到卡片或详细内容",
        "kind": "fact、impact 或 watch",
        "evidence_indexes": [支撑该 Tab 的来源序号]
      }
    ]
  }
]

Story 材料：
%s

group_index 必须照抄材料中的 Story 序号，不得使用当前批次内的相对序号。`, end-start, minStoryTabs, maxStoryTabs, minTabSummaryRunes, strings.Join(stories[start:end], "\n\n"))

		content, err := requestDeepSeek(apiKey, []DSMessage{
			{Role: "system", Content: storyTabsSystemPrompt},
			{Role: "user", Content: prompt},
		}, DSRequestOptions{Thinking: "enabled", ReasoningEffort: "high"})
		if err != nil {
			return groups, err
		}

		var results []StoryTabsResult
		if err := json.Unmarshal([]byte(extractJSON(content)), &results); err != nil {
			return groups, fmt.Errorf("解析 Story Tabs JSON 失败: %w\n原始内容: %s", err, content)
		}

		for _, result := range results {
			if result.GroupIndex < 1 || result.GroupIndex > len(groups) {
				continue
			}
			group := &groups[result.GroupIndex-1]
			group.Tabs = normalizeStoryTabs(*group, result.Tabs)
		}
	}
	return withFallbackStoryTabs(groups), nil
}

func formatVisionMaterial(results []VisionResult) string {
	if len(results) == 0 {
		return ""
	}
	var sections []string
	for _, result := range results {
		var lines []string
		for _, fact := range result.Facts {
			lines = append(lines, "- "+fact)
		}
		for _, fact := range result.Uncertain {
			lines = append(lines, "- [不确定] "+fact)
		}
		if len(lines) > 0 {
			sections = append(sections, strings.Join(lines, "\n"))
		}
	}
	if len(sections) == 0 {
		return ""
	}
	return "\n图片证据（由远程图片视觉识别提取，仅可作为对应来源的事实依据）：\n" + strings.Join(sections, "\n")
}

func representativeSourceIndexes(group NewsGroup) []int {
	seen := make(map[int]bool)
	var indexes []int
	for _, highlight := range group.Highlights {
		if !seen[highlight.Index] {
			seen[highlight.Index] = true
			indexes = append(indexes, highlight.Index)
		}
		if len(indexes) == maxStoryTabSources {
			return indexes
		}
	}
	for _, index := range group.SourceIndexes {
		if !seen[index] {
			seen[index] = true
			indexes = append(indexes, index)
		}
		if len(indexes) == maxStoryTabSources {
			break
		}
	}
	return indexes
}

func normalizeStoryTabs(group NewsGroup, tabs []StoryTab) []StoryTab {
	validEvidence := make(map[int]bool, len(group.SourceIndexes))
	for _, index := range group.SourceIndexes {
		validEvidence[index] = true
	}

	seen := make(map[string]bool)
	normalized := make([]StoryTab, 0, maxStoryTabs)
	for _, tab := range tabs {
		tab.Title = strings.TrimSpace(tab.Title)
		tab.Summary = strings.TrimSpace(tab.Summary)
		tab.Subtitle = normalizeSceneSubtitle(tab.Subtitle)
		if tab.Title == "" || utf8.RuneCountInString(tab.Summary) < minTabSummaryRunes {
			continue
		}
		if tab.Subtitle == "" {
			tab.Subtitle = fallbackTabSubtitle(tab)
		}
		if tab.Kind != "fact" && tab.Kind != "impact" && tab.Kind != "watch" {
			tab.Kind = "fact"
		}
		var evidence []int
		evidenceSeen := make(map[int]bool)
		for _, index := range tab.EvidenceIndexes {
			if validEvidence[index] && !evidenceSeen[index] {
				evidenceSeen[index] = true
				evidence = append(evidence, index)
			}
		}
		if len(evidence) == 0 && len(group.SourceIndexes) > 0 {
			evidence = []int{group.SourceIndexes[0]}
		}
		tab.EvidenceIndexes = evidence

		key := normalizeTitle(tab.Title + tab.Summary)
		if seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, tab)
		if len(normalized) == maxStoryTabs {
			break
		}
	}
	return normalized
}

func withFallbackStoryTabs(groups []NewsGroup) []NewsGroup {
	for i := range groups {
		group := &groups[i]
		group.Tabs = normalizeStoryTabs(*group, group.Tabs)
		for _, fallback := range fallbackStoryTabs(*group) {
			if len(group.Tabs) >= minStoryTabs {
				break
			}
			candidate := normalizeStoryTabs(*group, []StoryTab{fallback})
			if len(candidate) == 0 || containsEquivalentTab(group.Tabs, candidate[0]) {
				continue
			}
			group.Tabs = append(group.Tabs, candidate[0])
		}
	}
	return groups
}

func fallbackStoryTabs(group NewsGroup) []StoryTab {
	evidence := append([]int(nil), group.SourceIndexes...)
	return []StoryTab{
		{
			Title:           "事件概览",
			Summary:         fmt.Sprintf("%s。%s", group.Title, group.Reason),
			Subtitle:        fallbackSubtitleFromText(group.Title),
			Kind:            "fact",
			EvidenceIndexes: evidence,
		},
		{
			Title:           "后续观察",
			Summary:         "当前信息仍需结合后续正式公告与实际上线范围继续确认，使用前不宜将未确认内容视为最终规则。",
			Subtitle:        "具体细节仍需等待后续正式公告确认。",
			Kind:            "watch",
			EvidenceIndexes: evidence,
		},
	}
}

func normalizeSceneSubtitle(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "**", "")
	value = strings.ReplaceAll(value, "`", "")
	if value == "" {
		return ""
	}
	if containsAny(value, "请看", "卡片", "tab", "Tab", "画面", "详细内容", "事件概览", "当前要点") {
		return ""
	}
	if utf8.RuneCountInString(value) > maxSceneSubtitleRunes {
		return ""
	}
	if utf8.RuneCountInString(value) < minSceneSubtitleRunes {
		return ""
	}
	if startsWithIncompleteCause(value) {
		return ""
	}
	return value
}

func startsWithIncompleteCause(value string) bool {
	length := utf8.RuneCountInString(value)
	return length < 36 && strings.HasPrefix(value, "因") ||
		length < 36 && strings.HasPrefix(value, "由于") ||
		length < 36 && strings.HasPrefix(value, "受")
}

func fallbackTabSubtitle(tab StoryTab) string {
	if subtitle := fallbackSubtitleFromText(tab.Summary); subtitle != "" {
		return subtitle
	}
	return fallbackSubtitleFromText(tab.Title)
}

func fallbackSubtitleFromText(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "**", "")
	value = strings.ReplaceAll(value, "`", "")
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return ""
	}

	runes := []rune(value)
	if len(runes) <= maxSceneSubtitleRunes {
		return string(runes)
	}

	lastHardBreak := -1
	lastSoftBreak := -1
	for index, r := range runes[:maxSceneSubtitleRunes] {
		length := index + 1
		if strings.ContainsRune("。！？!?；;", r) && length >= minSceneSubtitleRunes {
			lastHardBreak = index
		}
		if strings.ContainsRune("，,：:", r) && length >= minSceneSubtitleRunes {
			lastSoftBreak = index
		}
	}
	if lastHardBreak >= minSceneSubtitleRunes-1 {
		return string(runes[:lastHardBreak+1])
	}
	if lastSoftBreak >= minSceneSubtitleRunes-1 {
		return string(runes[:lastSoftBreak]) + "。"
	}
	return string(runes[:maxSceneSubtitleRunes-1]) + "。"
}

func containsEquivalentTab(tabs []StoryTab, candidate StoryTab) bool {
	candidateKey := normalizeTitle(candidate.Title + candidate.Summary)
	for _, tab := range tabs {
		if normalizeTitle(tab.Title+tab.Summary) == candidateKey {
			return true
		}
	}
	return false
}
