package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// 本文件是 story_tabs.go 的文本校验与兜底部分：负责校正模型返回的 Tab 内容、
// 校验/降级口播字幕，并在模型结果不足时生成保底 Tab。它不涉及批次编排、
// 重试或模型调用（见 story_tabs.go）。

// normalizeStoryTabs 校正模型返回的 Tabs：丢弃标题空、摘要过短或无有效证据的项，补全 kind，去重并截断到上限。
func normalizeStoryTabs(group NewsGroup, tabs []StoryTab) []StoryTab {
	normalized, _ := normalizeStoryTabsWithReasons(group, tabs)
	return normalized
}

// rejectedTab 记录一个被丢弃的 Tab 及其失败原因，用于带反馈重试。
type rejectedTab struct {
	Tab    StoryTab
	Reason string
}

// normalizeStoryTabsWithReasons 与 normalizeStoryTabs 行为一致，额外返回被丢弃 Tab 的失败原因。
func normalizeStoryTabsWithReasons(group NewsGroup, tabs []StoryTab) ([]StoryTab, []rejectedTab) {
	validEvidence := make(map[int]bool, len(group.SourceIndexes))
	for _, index := range group.SourceIndexes {
		validEvidence[index] = true
	}

	seen := make(map[string]bool)
	normalized := make([]StoryTab, 0, maxStoryTabs)
	var rejected []rejectedTab
	for _, tab := range tabs {
		tab.Title = strings.TrimSpace(tab.Title)
		tab.Summary = strings.TrimSpace(tab.Summary)
		if reason := tabRejectionReason(tab); reason != "" {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: reason})
			continue
		}

		tab.Subtitle = normalizeSceneSubtitle(tab.Subtitle)
		tab.subtitleFallback = tab.Subtitle == ""
		if tab.subtitleFallback {
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
		if len(evidence) == 0 {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: "evidence_indexes 未包含该 Story 的有效来源序号"})
			continue
		}
		tab.EvidenceIndexes = evidence

		key := normalizeTitle(tab.Title + tab.Summary)
		if seen[key] {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: "与已保留 Tab 内容重复"})
			continue
		}
		seen[key] = true
		normalized = append(normalized, tab)
		if len(normalized) == maxStoryTabs {
			break
		}
	}
	return normalized, rejected
}

// tabRejectionReason 返回 Tab 内容层面的失败原因；通过校验返回空串。
// 失败原因可被反馈给模型用于定向修正，因此只描述内容问题，不描述序号/去重等程序性校验。
// 注意：subtitle 校验失败不在此列——原行为是退到 fallbackTabSubtitle 兜底，不丢弃 Tab。
func tabRejectionReason(tab StoryTab) string {
	switch {
	case tab.Title == "":
		return "Tab 标题为空"
	case utf8.RuneCountInString(tab.Summary) < minTabSummaryRunes:
		return fmt.Sprintf("summary 仅 %d 字，不足 %d 字下限", utf8.RuneCountInString(tab.Summary), minTabSummaryRunes)
	}
	return ""
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
	// 界面提示词在任意位置都应拒绝；栏目名只拒绝纯标签或带分隔符的标签前缀，
	// 避免误伤“这项变化对用户影响较小”一类正常新闻口播。
	lowerValue := strings.ToLower(value)
	if containsAny(lowerValue,
		"请看", "卡片", "tab", "画面", "详细内容", "当前要点", "内容详情",
	) {
		return ""
	}
	if startsWithColumnLabel(lowerValue) {
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

// startsWithColumnLabel 判断字幕是否只是栏目名，或以“栏目名：”等标签形式开头。
func startsWithColumnLabel(value string) bool {
	labels := []string{"事件概览", "具体变化", "用户影响", "后续观察", "后续进展", "要点总结"}
	for _, label := range labels {
		if value == label {
			return true
		}
		if !strings.HasPrefix(value, label) {
			continue
		}
		remainder := strings.TrimPrefix(value, label)
		if remainder == "" {
			return true
		}
		firstRune, _ := utf8.DecodeRuneInString(remainder)
		if strings.ContainsRune("：:，,、- \t\n", firstRune) {
			return true
		}
	}
	return false
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
