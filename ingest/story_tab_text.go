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
	tabSummaryCodeCandidatePattern   = regexp.MustCompile(`(?i)(ChatGPT(?:\s+(?:Business|Plus|Pro|Team|Enterprise))?|Google Play(?: Store)?|Service Unavailable|AWS(?: Bedrock)?|Hacker News|AlphaWave Semi|Andon Labs|Cross-region inference|LinkedIn|Decoy\s+Font|AnuNeko|Patreon|Cloudflare|WordPress|wp2shell|iCloud\+|Apple\s+Music|SpaceXAI|SpaceX|xAI|Grok(?:\s+Voice(?:\s+Think\s+Fast)?(?:\s+\d+(?:\.\d+)?)?)?|HAWK|AES(?:-\d+)?|Serpent|Salsa20|SHA-1|MaaS|SaaS|GTM|Intern-S2[A-Za-z0-9.-]*|Monolith-[A-Za-z0-9.-]+|Fable\s*\d+|启元\s*T1|红烛故事|FamilyMart|Honda|ANA|Tibo|Claude(?:\s+(?:Code|Design|Fable|Mythos|Opus))?(?:\s+Preview)?(?:\s*\d+(?:\.\d+)?)?|GPT[-\s]?\d+(?:\.\d+)?(?:[-\s][A-Za-z0-9]+)*|Qwen[A-Za-z0-9.-]*|GLM[-A-Za-z0-9.]*|Gemini(?:[-\s][A-Za-z0-9.]+)*|OpenAI|Anthropic|Codex|DeepSeek|Kimi(?:\s+[A-Za-z0-9.-]+)?|Kiro|Qoder|Tabbit|Jalapeño|Broadcom|Celestica|Tomahawk|MiniMax[A-Za-z0-9.-]*|FFmpeg|CVE-\d+-\d+|PixelSmash|MagicYUV|MCP|API|VLC|Jellyfin|Kodi|Nextcloud|OBS|Slack|GitHub|Serverless|Web|Pro|PLUS)`)
	tabSummaryBoldCandidatePattern   = regexp.MustCompile(`(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:之前|之后|起|前|后)?|\d{1,2}\s*月\s*\d{1,2}\s*日(?:之前|之后|起|前|后)?|\d+(?:\.\d+)?\s*(?:美元|元|土币|土耳其里拉|TB|GB|MB|K|%|折|倍|x|h|个|天|小时|分钟|月|年)|全球首款|轮足人形与四足|两种形态|自动切换变形|消费级机器人|线下体验门店|降低推理成本|推理成本|全栈平台|服务不可用|服务中断|无法(?:正常)?使用|不可用|停止(?:新购|续费|升级|运营)?|不再提供|移除限制|额度重置|再次延期|支持(?:原生)?多模态|多模态能力|切换至\s*Web\s*订阅|按需调节模型推理程度|周期性或触发性问题|灰色渠道风险|封禁|误封|降价|涨价|折扣|上线|恢复|开源)`)
	tabSummaryActionCandidatePattern = regexp.MustCompile(`(?:允许|导致|造成|使得|实现|支持|禁止|阻止|保护|关闭|停止|保留|恢复|开放|发布|开源|覆盖|上涨|下降|增长|减少|提升|降低|达到|超过|降至|升至|面临|看到|优先读取|显示|指出|发现|找到|采用|整合|终结|削减|违背|提速|成为|称为|开启内测|持积极态度|维持积极态度|保持积极态度)[^，。；;！？!?\n]{2,32}`)
	tabSummaryBoldSpanPattern        = regexp.MustCompile(`\*\*[^*]+\*\*`)
	tabSummaryCodeSpanPattern        = regexp.MustCompile("`[^`]+`")
	tabSummaryMarkupSpanPattern      = regexp.MustCompile("\\*\\*[^*]+\\*\\*|`[^`]+`")
	tabSummaryPlainClausePattern     = regexp.MustCompile(`[^，。；;！？!?\n]+`)
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
	seenTitles := make(map[string]bool)
	var seenSummaries []string
	normalized := make([]StoryTab, 0, maxStoryTabs)
	var rejected []rejectedTab
	for _, tab := range tabs {
		tab.Title = strings.TrimSpace(tab.Title)
		tab.Summary = strings.TrimSpace(tab.Summary)
		tab.Summary = enrichTabSummaryMarkdown(tab.Summary)
		if reason := tabRejectionReason(tab); reason != "" {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: reason})
			continue
		}
		titleKey := normalizeTitle(tab.Title)
		resolvedTitleKey := normalizeTitle(resolvedContentTitle(group))
		if titleKey == normalizeTitle(group.Title) || resolvedTitleKey != "" && titleKey == resolvedTitleKey {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: "Tab 标题复制了完整 Story 标题；必须改成该卡独有的事实角度"})
			continue
		}
		if seenTitles[titleKey] {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: "Tab 标题与同 Story 的另一张卡重复；每张卡必须有独立角度"})
			continue
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
		summaryKey := normalizeTitle(strings.NewReplacer("**", "", "`", "").Replace(tab.Summary))
		if overlapsExistingTabSummary(summaryKey, seenSummaries) {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: "summary 与同 Story 的另一张卡大段包含或重复；应拆成互不重叠的独立事实"})
			continue
		}

		key := normalizeTitle(tab.Title + tab.Summary)
		if seen[key] {
			rejected = append(rejected, rejectedTab{Tab: tab, Reason: "与已保留 Tab 内容重复"})
			continue
		}
		seen[key] = true
		seenTitles[titleKey] = true
		seenSummaries = append(seenSummaries, summaryKey)
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
	visibleRunes := tabSummaryVisibleRuneCount(tab.Summary)
	boldSpans := tabSummaryBoldSpanPattern.FindAllString(tab.Summary, -1)
	unformattedCodeCandidate := firstUnformattedTabSummaryCodeCandidate(tab.Summary)
	switch {
	case tab.Title == "":
		return "Tab 标题为空"
	case tabSummaryMarkdownIssue(tab.Summary) != "":
		return "summary Markdown 不合法：" + tabSummaryMarkdownIssue(tab.Summary)
	case visibleRunes < minTabSummaryRunes:
		return fmt.Sprintf("summary 仅 %d 个可见字符，不足 %d 字下限", visibleRunes, minTabSummaryRunes)
	case visibleRunes > maxTabSummaryVisibleRunes:
		return fmt.Sprintf("summary 有 %d 个可见字符，超过 %d 字上限", visibleRunes, maxTabSummaryVisibleRunes)
	case len(boldSpans) == 0:
		return "summary 缺少粗体；必须且只能用一段粗体突出核心变化、机制、影响或结论"
	case len(boldSpans) > 1:
		return "summary 粗体超过一段；只保留一个最重要结论，其余内容用普通文本或拆到新 Tab"
	case unformattedCodeCandidate != "":
		return fmt.Sprintf("summary 中英文模型/产品/API 专名 %q 未使用行内代码", unformattedCodeCandidate)
	case tabSummaryVisualUnits(tab.Summary) > float64(maxTabSummaryVisibleRunes):
		return fmt.Sprintf("summary 格式化后视觉占用 %.1f，超过 %d 单位上限；请缩短或拆成更多 Tab", tabSummaryVisualUnits(tab.Summary), maxTabSummaryVisibleRunes)
	case !hasCompleteSummaryEnding(tab.Summary):
		return "summary 不是完整句子或疑似被硬截断；必须在完整句末结束，放不下时拆成更多 Tab"
	case hasTruncationArtifact(tab.Summary):
		return "summary 含省略号或残缺括号，疑似从正文硬截断；必须改写成完整事实"
	case isLowInformationUncertainty(tab.Title, tab.Summary):
		return "空信息不确定性 Tab：不要把“等待官方确认/尚未公布”单独做成内容，请改为具体事实或用户影响"
	}
	return ""
}

// tabSummaryMarkdownIssue 校验项目支持的受限 Markdown。粗体和行内代码必须
// 成对、互不交叉或嵌套，也不能把同一个英文专名拆在反引号两侧。
func tabSummaryMarkdownIssue(value string) string {
	boldLocations := tabSummaryBoldSpanPattern.FindAllStringIndex(value, -1)
	codeLocations := tabSummaryCodeSpanPattern.FindAllStringIndex(value, -1)
	if strings.Count(value, "**") != len(boldLocations)*2 {
		return "粗体标记未成对或包含嵌套星号"
	}
	if strings.Count(value, "`") != len(codeLocations)*2 {
		return "行内代码标记未成对"
	}
	for _, bold := range boldLocations {
		content := strings.TrimSpace(value[bold[0]+2 : bold[1]-2])
		if strings.HasSuffix(content, "“") || strings.HasSuffix(content, "‘") ||
			strings.HasSuffix(content, "（") || strings.HasSuffix(content, "(") ||
			strings.HasSuffix(content, "《") || strings.HasSuffix(content, "【") ||
			strings.HasPrefix(content, "”") || strings.HasPrefix(content, "’") ||
			strings.HasPrefix(content, "）") || strings.HasPrefix(content, ")") ||
			strings.HasPrefix(content, "》") || strings.HasPrefix(content, "】") {
			return "粗体边界截断了成对标点"
		}
		for _, code := range codeLocations {
			if bold[0] < code[1] && code[0] < bold[1] {
				return "粗体与行内代码发生交叉或嵌套"
			}
		}
	}
	for _, code := range codeLocations {
		if code[0] > 0 && isASCIIMarkdownTokenByte(value[code[0]-1]) ||
			code[1] < len(value) && isASCIIMarkdownTokenByte(value[code[1]]) {
			return "行内代码拆开了同一个英文专名"
		}
	}
	return ""
}

func isASCIIMarkdownTokenByte(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' ||
		value >= '0' && value <= '9' || strings.ContainsRune("-_.+", rune(value))
}

func hasTruncationArtifact(value string) bool {
	plain := strings.TrimSpace(strings.NewReplacer("**", "", "`", "").Replace(value))
	return strings.Contains(plain, "…") || strings.Contains(plain, "...") ||
		strings.HasSuffix(plain, "[!") || strings.HasSuffix(plain, "[")
}

// normalizeStoryScenesWithReasons 校验 Story 级口播。Scene 总结整条新闻，与 Tab
// 数量无关；普通 Story 一条即可，证据充分需要更多口播段时最多 maxStoryScenes 条，
// 避免把信息卡逐张念给观众。
func normalizeStoryScenesWithReasons(group NewsGroup, scenes []StoryScene) ([]StoryScene, []string) {
	validEvidence := make(map[int]bool, len(group.SourceIndexes))
	for _, index := range group.SourceIndexes {
		validEvidence[index] = true
	}

	seen := make(map[string]bool)
	result := make([]StoryScene, 0, maxStoryScenes)
	var rejected []string
	for _, scene := range scenes {
		subtitle := normalizeSceneSubtitle(scene.Subtitle)
		if subtitle == "" {
			rejected = append(rejected, "subtitle 不是 28 至 96 字的完整事实口播，或包含界面提示/空信息")
			continue
		}
		if hasTruncationArtifact(subtitle) {
			rejected = append(rejected, "subtitle 含省略号或正文截断残片")
			continue
		}
		key := normalizeTitle(subtitle)
		if seen[key] {
			rejected = append(rejected, "subtitle 与另一条 Scene 重复")
			continue
		}
		var evidence []int
		evidenceSeen := make(map[int]bool)
		for _, index := range scene.EvidenceIndexes {
			if validEvidence[index] && !evidenceSeen[index] {
				evidenceSeen[index] = true
				evidence = append(evidence, index)
			}
		}
		if len(evidence) == 0 {
			rejected = append(rejected, "evidence_indexes 未包含该 Story 的有效来源序号")
			continue
		}
		seen[key] = true
		result = append(result, StoryScene{Subtitle: subtitle, EvidenceIndexes: evidence})
		if len(result) >= maxStoryScenes {
			break
		}
	}
	return result, rejected
}

func hasCompleteSummaryEnding(summary string) bool {
	plain := strings.TrimSpace(strings.NewReplacer("**", "", "`", "").Replace(summary))
	plain = strings.TrimRight(plain, "\"'”’）》】")
	if plain == "" {
		return false
	}
	last, _ := utf8.DecodeLastRuneInString(plain)
	return strings.ContainsRune("。！？!?；;.", last)
}

func overlapsExistingTabSummary(candidate string, existing []string) bool {
	if utf8.RuneCountInString(candidate) < minTabSummaryRunes {
		return false
	}
	for _, previous := range existing {
		if utf8.RuneCountInString(previous) < minTabSummaryRunes {
			continue
		}
		if strings.Contains(candidate, previous) || strings.Contains(previous, candidate) {
			return true
		}
	}
	return false
}

// tabSummaryVisualUnits approximates the rendered width budget used by InlineMarkup.
// CJK counts as 1, ASCII as asciiWidthUnit (sourced from video-layout.json);
// bold/code spans add their font/padding overhead.
// The pure-text 110-rune contract stays intact while formatted cards get a fairer limit.
func tabSummaryVisualUnits(summary string) float64 {
	unitsFor := func(text string, multiplier float64) float64 {
		var units float64
		for _, r := range text {
			if r <= 0x7f {
				units += asciiWidthUnit * multiplier
			} else {
				units += multiplier
			}
		}
		return units
	}
	var units float64
	cursor := 0
	for _, location := range tabSummaryMarkupSpanPattern.FindAllStringIndex(summary, -1) {
		units += unitsFor(summary[cursor:location[0]], 1)
		match := summary[location[0]:location[1]]
		if strings.HasPrefix(match, "**") {
			content := strings.TrimSuffix(strings.TrimPrefix(match, "**"), "**")
			units += unitsFor(content, 1.08) + 0.35
		} else {
			content := strings.Trim(match, "`")
			units += unitsFor(content, 1.02) + 0.55
		}
		cursor = location[1]
	}
	units += unitsFor(summary[cursor:], 1)
	return units
}

func tabSummaryVisibleRuneCount(summary string) int {
	visible := strings.NewReplacer("**", "", "`", "").Replace(summary)
	return utf8.RuneCountInString(visible)
}

// enrichTabSummaryMarkdown 轻量补齐 Tab 摘要里的受限 Markdown：
// 粗体只补一个核心结论；模型/产品/API/错误码等专名可分别补多个行内代码。
func enrichTabSummaryMarkdown(summary string) string {
	summary = unwrapBoldCodeCandidates(summary)
	summary = addMissingInlineCodeSpans(summary)
	summary = addBoldIfMissing(summary)
	return summary
}

// unwrapBoldCodeCandidates 避免把产品名本身当作“重点结论”加粗。英文专名应使用
// 行内代码，粗体留给变化、机制、影响或结论；之后的 enrich 会分别补齐两种标记。
func unwrapBoldCodeCandidates(summary string) string {
	return tabSummaryBoldSpanPattern.ReplaceAllStringFunc(summary, func(span string) string {
		content := strings.TrimSuffix(strings.TrimPrefix(span, "**"), "**")
		if tabSummaryCodeCandidatePattern.MatchString(content) {
			return content
		}
		return span
	})
}

func firstUnformattedTabSummaryCodeCandidate(summary string) string {
	withoutCodeSpans := tabSummaryCodeSpanPattern.ReplaceAllString(summary, " ")
	return tabSummaryCodeCandidatePattern.FindString(withoutCodeSpans)
}

func addMissingInlineCodeSpans(summary string) string {
	original := summary
	offset := 0
	for _, loc := range tabSummaryCodeCandidatePattern.FindAllStringIndex(original, -1) {
		if len(loc) != 2 || loc[0] >= loc[1] {
			continue
		}
		if isInsideSummaryMarkdown(original, loc[0]) || isInsideSummaryMarkdown(original, loc[1]-1) {
			continue
		}
		start, end := loc[0]+offset, loc[1]+offset
		candidate := summary[:start] + "`" + summary[start:end] + "`" + summary[end:]
		if tabSummaryVisualUnits(candidate) > float64(maxTabSummaryVisibleRunes) {
			continue
		}
		summary = candidate
		offset += 2
	}
	return summary
}

func addBoldIfMissing(summary string) string {
	if strings.Contains(summary, "**") {
		return summary
	}
	if enriched := wrapFirstMarkdownCandidate(summary, tabSummaryBoldCandidatePattern, "**", "**"); enriched != summary {
		return enriched
	}
	if enriched := wrapBestMarkdownCandidate(summary, tabSummaryActionCandidatePattern, "**", "**"); enriched != summary {
		return enriched
	}
	return wrapFallbackBoldClause(summary)
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

// wrapBestMarkdownCandidate 用于结论型粗体兜底：同一句里可能有多个动作短语，
// 选择信息量最大的完整候选，而不是机械加粗第一个短动词。
func wrapBestMarkdownCandidate(summary string, pattern *regexp.Regexp, prefix, suffix string) string {
	bestStart, bestEnd, bestRunes := -1, -1, 0
	for _, loc := range pattern.FindAllStringIndex(summary, -1) {
		if len(loc) != 2 || loc[0] >= loc[1] {
			continue
		}
		if isInsideSummaryMarkdown(summary, loc[0]) || isInsideSummaryMarkdown(summary, loc[1]-1) {
			continue
		}
		candidate := strings.TrimSpace(summary[loc[0]:loc[1]])
		if strings.Contains(candidate, "`") {
			continue
		}
		runes := utf8.RuneCountInString(candidate)
		if runes > bestRunes {
			bestStart = loc[0]
			bestEnd = loc[1]
			bestRunes = runes
		}
	}
	if bestStart < 0 {
		return summary
	}
	return summary[:bestStart] + prefix + summary[bestStart:bestEnd] + suffix + summary[bestEnd:]
}

// wrapFallbackBoldClause guarantees the rendering contract even when a valid factual
// sentence contains none of the known number/action signals. It only selects plain text
// outside existing inline-code spans and leaves the sentence itself unchanged.
func wrapFallbackBoldClause(summary string) string {
	bestStart, bestEnd, bestRunes := -1, -1, 0
	considerRange := func(start, end int) {
		if start >= end {
			return
		}
		for _, loc := range tabSummaryPlainClausePattern.FindAllStringIndex(summary[start:end], -1) {
			candidateStart, candidateEnd := start+loc[0], start+loc[1]
			candidate := strings.TrimSpace(summary[candidateStart:candidateEnd])
			if candidate == "" {
				continue
			}
			leading := len(summary[candidateStart:candidateEnd]) - len(strings.TrimLeft(summary[candidateStart:candidateEnd], " \t\r\n"))
			candidateStart += leading
			runes := utf8.RuneCountInString(candidate)
			if runes < 4 || runes <= bestRunes {
				continue
			}
			if runes > 32 {
				candidate = string([]rune(candidate)[:32])
				candidateEnd = candidateStart + len(candidate)
				runes = 32
			} else {
				candidateEnd = candidateStart + len(candidate)
			}
			bestStart, bestEnd, bestRunes = candidateStart, candidateEnd, runes
		}
	}

	cursor := 0
	for _, loc := range tabSummaryMarkupSpanPattern.FindAllStringIndex(summary, -1) {
		considerRange(cursor, loc[0])
		cursor = loc[1]
	}
	considerRange(cursor, len(summary))
	if bestStart < 0 {
		return summary
	}
	return summary[:bestStart] + "**" + summary[bestStart:bestEnd] + "**" + summary[bestEnd:]
}

func isInsideSummaryMarkdown(summary string, index int) bool {
	if index <= 0 {
		return false
	}
	before := summary[:index]
	return strings.Count(before, "`")%2 == 1 || strings.Count(before, "**")%2 == 1
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
