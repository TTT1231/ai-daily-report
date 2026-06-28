package main

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// 本文件是 story_tabs.go 的文本校验部分：负责校正模型返回的 Tab 内容、
// 校验/降级口播字幕。它不涉及批次编排、重试或模型调用（见 story_tabs.go）。

var (
	tabSummaryCodeCandidatePattern = regexp.MustCompile(`(?i)(ChatGPT(?:\s+(?:Business|Plus|Pro|Team|Enterprise))?|Google Play(?: Store)?|Service Unavailable|AWS(?: Bedrock)?|Hacker News|AlphaWave Semi|Cross-region inference|Claude(?:\s+(?:Code|Design|Fable|Mythos|Opus))?(?:\s*\d+(?:\.\d+)?)?|GPT[-\s]?\d+(?:\.\d+)?(?:[-\s][A-Za-z0-9]+)*|Qwen[A-Za-z0-9.-]*|GLM[-A-Za-z0-9.]*|Gemini(?:[-\s][A-Za-z0-9.]+)*|OpenAI|Anthropic|Codex|DeepSeek|Kimi|Kiro|Qoder|Tabbit|Jalapeño|Broadcom|Celestica|Tomahawk|MiniMax[A-Za-z0-9.-]*|FFmpeg|CVE-\d+-\d+|PixelSmash|MagicYUV|MCP|API|VLC|Jellyfin|Kodi|Nextcloud|OBS|Slack|GitHub|Serverless|Web|Pro|PLUS)`)
	tabSummaryBoldCandidatePattern = regexp.MustCompile(`(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:之前|之后|起|前|后)?|\d+(?:\.\d+)?\s*(?:美元|元|土币|土耳其里拉|TB|GB|MB|K|%|折|倍|x|个|天|小时|分钟|月|年)|降低推理成本|推理成本|全栈平台|服务不可用|服务中断|无法(?:正常)?使用|不可用|停止(?:新购|续费|升级)?|不再提供|支持(?:原生)?多模态|多模态能力|切换至\s*Web\s*订阅|按需调节模型推理程度|周期性或触发性问题|灰色渠道风险|封禁|误封|降价|涨价|折扣|上线|恢复|开源)`)
	tabSummaryBoldSpanPattern      = regexp.MustCompile(`\*\*[^*]+\*\*`)
)

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
		tab.Summary = enrichTabSummaryMarkdown(tab.Summary)

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
	case isLowInformationUncertainty(tab.Title, tab.Summary):
		return "空信息不确定性 Tab：不要把“等待官方确认/尚未公布”单独做成内容，请改为具体事实或用户影响"
	}
	return ""
}

// enrichTabSummaryMarkdown 轻量补齐 Tab 摘要里的受限 Markdown：
// 生成模型有时会稳定加粗，但漏掉模型/产品/错误码的行内代码标记。
// 这里只补第一个明显候选，避免把 summary 变成满屏装饰。
func enrichTabSummaryMarkdown(summary string) string {
	summary = addInlineCodeIfMissing(summary)
	summary = addBoldIfMissing(summary)
	return summary
}

func addInlineCodeIfMissing(summary string) string {
	if strings.Contains(summary, "`") {
		return summary
	}
	enriched := wrapFirstMarkdownCandidate(summary, tabSummaryCodeCandidatePattern, "`", "`")
	if enriched != summary {
		return enriched
	}
	return splitBoldSpanForInlineCode(summary)
}

func addBoldIfMissing(summary string) string {
	if strings.Contains(summary, "**") {
		return summary
	}
	return wrapFirstMarkdownCandidate(summary, tabSummaryBoldCandidatePattern, "**", "**")
}

func wrapFirstMarkdownCandidate(summary string, pattern *regexp.Regexp, prefix, suffix string) string {
	for _, loc := range pattern.FindAllStringIndex(summary, -1) {
		if len(loc) != 2 || loc[0] >= loc[1] {
			continue
		}
		if isInsideSummaryMarkdown(summary, loc[0]) || isInsideSummaryMarkdown(summary, loc[1]-1) {
			continue
		}
		return summary[:loc[0]] + prefix + summary[loc[0]:loc[1]] + suffix + summary[loc[1]:]
	}
	return summary
}

func isInsideSummaryMarkdown(summary string, index int) bool {
	if index <= 0 {
		return false
	}
	before := summary[:index]
	return strings.Count(before, "`")%2 == 1 || strings.Count(before, "**")%2 == 1
}

func splitBoldSpanForInlineCode(summary string) string {
	for _, span := range tabSummaryBoldSpanPattern.FindAllStringIndex(summary, -1) {
		contentStart, contentEnd := span[0]+2, span[1]-2
		content := summary[contentStart:contentEnd]
		loc := tabSummaryCodeCandidatePattern.FindStringIndex(content)
		if len(loc) != 2 || loc[0] >= loc[1] {
			continue
		}
		candidate := strings.TrimSpace(content[loc[0]:loc[1]])
		if candidate == "" {
			continue
		}
		var parts []string
		if before := strings.TrimSpace(content[:loc[0]]); before != "" {
			parts = append(parts, "**"+before+"**")
		}
		parts = append(parts, "`"+candidate+"`")
		if after := strings.TrimSpace(content[loc[1]:]); after != "" {
			parts = append(parts, "**"+after+"**")
		}
		return summary[:span[0]] + strings.Join(parts, " ") + summary[span[1]:]
	}
	return summary
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
	if isLowInformationUncertainty("", value) {
		return ""
	}
	return value
}

// isLowInformationUncertainty 拦截“单独讲未知”的卡片或口播。
// 不确定性可以作为具体事实的限定词，但不能独立占一个 Tab/scene。
func isLowInformationUncertainty(title, body string) bool {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	text := strings.TrimSpace(title + "。" + body)
	if text == "。" {
		return false
	}

	if containsAny(title,
		"待确认", "待核实", "待观察", "服务恢复时间",
		"官方尚未", "官方未", "尚未公布", "未公布", "未说明", "未回应",
		"替代方案", "补偿措施", "生效日期",
	) && containsAny(body,
		"未说明", "尚未", "未公布", "未明确", "进一步确认", "进一步回应", "有待官方", "等待", "需关注", "需留意",
	) {
		return true
	}
	if strings.Contains(title, "后续观察") &&
		containsAny(body, "需关注", "需留意", "尚未给出明确时间表", "仍待确认") &&
		!hasSpecificWatchAnchor(body) {
		return true
	}

	if containsAny(text,
		"尚未公布替代",
		"未发布官方说明",
		"恢复时间均不明确",
		"恢复时间尚未公布",
		"后续需等待进一步说明",
		"等待后续通知",
		"有待官方明确",
	) {
		return true
	}

	return strings.Contains(text, "能否") && containsAny(text, "待确认", "待观察")
}

func hasSpecificWatchAnchor(text string) bool {
	return containsAny(text,
		"Issue", "issue", "#", "工单", "编号", "状态页", "文档", "入口",
		"日期", "价格", "额度", "版本", "规则",
	)
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
