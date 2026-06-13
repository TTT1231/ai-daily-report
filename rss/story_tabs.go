package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// generateStoryTabs 让模型根据来源正文为每个 Story 编排 2-6 个视频 Tab（含摘要与口播字幕），
// 分批处理并对结果做校验与保底补齐，最终保证每个 Story 都有足够的 Tab。
func generateStoryTabs(ai AIConfig, groups []NewsGroup, items []Item) ([]NewsGroup, error) {
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
				"来源 %d\n来源站点：%s\n标题：%s\n来源正文：%s%s",
				index, item.SourceName, item.Title, cleanRSS2ItemText(item), visionMaterial,
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

		content, err := requestModel(ai, []ChatMessage{
			{Role: "system", Content: storyTabsSystemPrompt},
			{Role: "user", Content: prompt},
		})
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

// formatVisionMaterial 把图片视觉识别结果格式化为送给模型的事实材料文本，不确定项会标注“[不确定]”。
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

// representativeSourceIndexes 选出代表本 Story 的来源序号：优先要点指向的来源，再补其它来源，最多 maxStoryTabSources 个。
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

// normalizeStoryTabs 校正模型返回的 Tabs：丢弃标题空/摘要过短的，补全 kind 与证据序号，去重并截断到上限。
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

// withFallbackStoryTabs 确保每个 Story 至少有 minStoryTabs 个有效 Tab：
// 先校正已有 Tab，不足时用保底 Tab 补齐且避免重复。
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

// fallbackStoryTabs 生成两个保底 Tab（“事件概览”+“后续观察”），用于模型结果不足时的确定性补齐。
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

// normalizeSceneSubtitle 校验并清洗口播字幕：去 Markdown、拒绝界面提示词与不完整短句、限制长度，不合格时返回空串。
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

// startsWithIncompleteCause 判断较短的口播是否以“因/由于/受”开头而缺少完整结论，这类残缺字幕应被拒绝。
func startsWithIncompleteCause(value string) bool {
	length := utf8.RuneCountInString(value)
	return length < 36 && strings.HasPrefix(value, "因") ||
		length < 36 && strings.HasPrefix(value, "由于") ||
		length < 36 && strings.HasPrefix(value, "受")
}

// fallbackTabSubtitle 当模型字幕无效时，从 Tab 摘要（再退到标题）生成口播字幕。
func fallbackTabSubtitle(tab StoryTab) string {
	if subtitle := fallbackSubtitleFromText(tab.Summary); subtitle != "" {
		return subtitle
	}
	return fallbackSubtitleFromText(tab.Title)
}

// fallbackSubtitleFromText 把任意文本裁剪成符合长度要求的口播字幕：
// 优先在句末/逗号处断句，无法断句时按上限硬截断并补句号。
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

// containsEquivalentTab 判断候选 Tab 是否与已有任一 Tab 内容等价（按规范化标题+摘要比较），用于补齐时去重。
func containsEquivalentTab(tabs []StoryTab, candidate StoryTab) bool {
	candidateKey := normalizeTitle(candidate.Title + candidate.Summary)
	for _, tab := range tabs {
		if normalizeTitle(tab.Title+tab.Summary) == candidateKey {
			return true
		}
	}
	return false
}
