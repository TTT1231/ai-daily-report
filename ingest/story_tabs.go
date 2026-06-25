package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// generateStoryTabs 让模型根据来源正文为每个 Story 编排 2-6 个视频 Tab（含摘要与口播字幕），
// 分批处理并对结果做校验与保底补齐，最终保证每个 Story 都有足够的 Tab。
func generateStoryTabs(ai AIConfig, groups []NewsGroup, items []Item) ([]NewsGroup, error) {
	vision := newVisionAnalyzer()
	retryCalls := 0
	var materials []storyTabMaterial
	for i := range groups {
		group := &groups[i]
		var sources []string
		for _, index := range representativeSourceIndexes(*group) {
			if index < 1 || index > len(items) {
				continue
			}
			item := items[index-1]
			visionResults := vision.analyzeItem(index, item, *group)
			for _, result := range visionResults {
				if result.OverlayPath == "" {
					continue
				}
				group.ImageAssets = append(group.ImageAssets, StoryImage{
					SourceIndex: result.SourceIndex,
					SourceTitle: result.SourceTitle,
					URL:         result.ImageURL,
					Path:        result.OverlayPath,
					Width:       result.OverlayW,
					Height:      result.OverlayH,
					Facts:       append([]string(nil), result.Facts...),
					Uncertain:   append([]string(nil), result.Uncertain...),
					Summary:     result.Summary,
				})
			}
			visionMaterial := formatVisionMaterial(visionResults)
			sources = append(sources, fmt.Sprintf(
				"来源 %d\n来源站点：%s\n标题：%s\n来源正文：%s%s",
				index, item.SourceName, item.Title, cleanRSS2ItemText(item), visionMaterial,
			))
		}
		materials = append(materials, storyTabMaterial{GroupIndex: i + 1, Body: fmt.Sprintf(
			`Story %d
主题：%s
重要性：%s
可引用来源序号：%v
%s`,
			i+1, group.Title, group.Reason, group.SourceIndexes, strings.Join(sources, "\n"),
		)})
	}
	for start := 0; start < len(materials); start += storyTabBatchSize {
		end := min(start+storyTabBatchSize, len(materials))
		batch := materials[start:end]
		results, err := requestStoryTabsBatchWithRetry(ai, batch, nil)
		if err != nil {
			return groups, err
		}
		applyStoryTabsResults(groups, batch, results)

		// 将本批所有未达标 Story 合并重试，既覆盖模型漏返回/只返回一个有效 Tab 的情况，
		// 也减少逐个 Story 重试带来的固定 prompt 与请求开销。
		retryBatch, feedbacks := collectStoryTabRetries(groups, batch)
		if len(retryBatch) > 0 {
			retryCalls += retryAndKeepBestTabs(ai, groups, retryBatch, feedbacks)
		}
	}
	stats := collectStoryTabQualityStats(groups)
	for i := range groups {
		groups[i].lastRejected = nil
	}
	groups = withFallbackStoryTabs(groups)
	fmt.Printf(
		"   质量校验：重试 %d 批，保底补齐 %d 个 Story，最终仍拒绝无有效证据 Tab %d 个，字幕降级 %d/%d 个\n",
		retryCalls, stats.fallbackStories, stats.evidenceRejections, stats.subtitleFallbacks, stats.acceptedTabs,
	)
	return groups, nil
}

// storyTabMaterial 缓存单个 Story 送给模型的材料文本及其全局序号，便于重试时复用。
type storyTabMaterial struct {
	GroupIndex int
	Body       string
}

// requestStoryTabsBatchWithRetry 调用 requestStoryTabsBatch，对瞬时失败（限流/5xx/网络）
// 退避重试，避免单批次抖动就直接整段回退到保底 Tabs。重试次数与请求成本独立于
// retryAndKeepBestTabs 的质量重试。
func requestStoryTabsBatchWithRetry(ai AIConfig, batch []storyTabMaterial, feedbacks map[int][]string) ([][]StoryTab, error) {
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		results, err := requestStoryTabsBatch(ai, batch, feedbacks)
		if err == nil {
			return results, nil
		}
		lastErr = err
		if attempt == maxAttempts {
			break
		}
		wait := time.Duration(attempt) * 5 * time.Second
		fmt.Printf("   ⚠️  警告：Story Tabs 批次请求第 %d 次失败，等待 %v 后重试: %v\n", attempt, wait, err)
		time.Sleep(wait)
	}
	return nil, lastErr
}

// requestStoryTabsBatch 调用模型为一个批次的 Story 生成 Tabs。
// feedbacks 非空时会把失败原因拼进 prompt，作为对该批次 Story 的定向修正指引；键为 GroupIndex。
func requestStoryTabsBatch(ai AIConfig, batch []storyTabMaterial, feedbacks map[int][]string) ([][]StoryTab, error) {
	prompt := buildStoryTabsPrompt(batch, feedbacks)
	content, err := requestModel(ai, []ChatMessage{
		{Role: "system", Content: storyTabsSystemPrompt},
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, err
	}
	var results []StoryTabsResult
	if err := json.Unmarshal([]byte(extractJSON(content)), &results); err != nil {
		return nil, fmt.Errorf("解析 Story Tabs JSON 失败: %w\n原始内容: %s", err, content)
	}

	out := make([][]StoryTab, len(batch))
	for _, result := range results {
		pos := batchPositionByIndex(batch, result.GroupIndex)
		if pos < 0 {
			continue
		}
		out[pos] = result.Tabs
	}
	return out, nil
}

// batchPositionByIndex 在批次内按全局 GroupIndex 找到位置，找不到返回 -1。
func batchPositionByIndex(batch []storyTabMaterial, groupIndex int) int {
	for i, m := range batch {
		if m.GroupIndex == groupIndex {
			return i
		}
	}
	return -1
}

// buildStoryTabsPrompt 构造批次 prompt；feedbacks 非空时追加每个 Story 的失败原因，要求模型针对性修正。
func buildStoryTabsPrompt(batch []storyTabMaterial, feedbacks map[int][]string) string {
	header := fmt.Sprintf(`请为以下 %d 个 Story 分别生成 %d 至 %d 个适合短视频展示的 Tabs。
每个 summary 至少 %d 个汉字。先完整覆盖来源中的独立事实，再决定 Tabs 数量；只有来源确实不超过两个独立事实时才使用两个 Tabs，不得虚构事实或用重复内容凑数。

严格返回以下 JSON，不要返回其他内容：
[
  {
    "group_index": Story 序号,
    "tabs": [
      {
        "title": "简短 Tab 标题",
        "summary": "至少二十个汉字的完整内容；模型/产品/API/错误码用行内代码，数字/日期/价格/关键结论用粗体",
        "subtitle": "28至96个汉字的完整新闻口播，包含主体、事件及范围或结果，禁止提到卡片或详细内容",
        "kind": "fact、impact 或 watch",
        "evidence_indexes": [支撑该 Tab 的来源序号]
      }
    ]
  }
]

Story 材料：
%s

group_index 必须照抄材料中的 Story 序号，不得使用当前批次内的相对序号。`, len(batch), minStoryTabs, maxStoryTabs, minTabSummaryRunes, joinMaterialBodies(batch))

	if len(feedbacks) == 0 {
		return header
	}

	var notes []string
	for _, m := range batch {
		reasons, ok := feedbacks[m.GroupIndex]
		if !ok || len(reasons) == 0 {
			continue
		}
		combined := strings.Join(reasons, "；")
		notes = append(notes, fmt.Sprintf("- Story %d 上轮生成结果未通过校验：%s。请基于同样的来源材料重新生成该 Story 的全部 Tabs，确保修正上述问题，不要原样复用被拒绝的 Tabs。", m.GroupIndex, combined))
	}
	return header + "\n\n需要修正的 Story：\n" + strings.Join(notes, "\n")
}

// joinMaterialBodies 把批次内各 Story 材料正文用空行拼接。
func joinMaterialBodies(batch []storyTabMaterial) string {
	bodies := make([]string, 0, len(batch))
	for _, m := range batch {
		bodies = append(bodies, m.Body)
	}
	return strings.Join(bodies, "\n\n")
}

// applyStoryTabsResults 把批次请求结果归一化后写入对应 Story，并缓存被丢弃原因供重试使用。
func applyStoryTabsResults(groups []NewsGroup, batch []storyTabMaterial, results [][]StoryTab) {
	for pos, tabs := range results {
		if pos < 0 || pos >= len(batch) {
			continue
		}
		group := &groups[batch[pos].GroupIndex-1]
		normalized, rejected := normalizeStoryTabsWithReasons(*group, tabs)
		group.Tabs = normalized
		group.lastRejected = rejected
	}
}

// collectStoryTabRetries 收集有效 Tab 数不足的 Story，并生成包含数量与内容校验问题的反馈。
func collectStoryTabRetries(groups []NewsGroup, batch []storyTabMaterial) ([]storyTabMaterial, map[int][]string) {
	retryBatch := make([]storyTabMaterial, 0, len(batch))
	feedbacks := make(map[int][]string)
	for _, m := range batch {
		group := &groups[m.GroupIndex-1]
		if len(group.Tabs) >= minStoryTabs {
			continue
		}
		retryBatch = append(retryBatch, m)
		feedbacks[m.GroupIndex] = storyTabFeedback(*group)
	}
	return retryBatch, feedbacks
}

// storyTabFeedback 汇总一个 Story 当前的数量缺口和最近一次内容校验失败原因。
func storyTabFeedback(group NewsGroup) []string {
	var reasons []string
	if len(group.Tabs) == 0 {
		reasons = append(reasons, "模型未返回该 Story 的有效 Tabs")
	} else if len(group.Tabs) < minStoryTabs {
		reasons = append(reasons, fmt.Sprintf("当前只有 %d 个有效 Tab，至少需要 %d 个", len(group.Tabs), minStoryTabs))
	}
	reasons = append(reasons, tabRejectionFeedbacks(group.lastRejected)...)
	return uniqueStrings(reasons)
}

// retryAndKeepBestTabs 对给定 Story 子集带反馈重试，最多 maxStoryTabRetries 次，
// 使用有效数量、要点覆盖、证据覆盖和原生字幕质量选择更好的结果，并返回实际调用次数。
func retryAndKeepBestTabs(ai AIConfig, groups []NewsGroup, batch []storyTabMaterial, feedbacks map[int][]string) int {
	calls := 0
	for attempt := 1; attempt <= maxStoryTabRetries; attempt++ {
		calls++
		results, err := requestStoryTabsBatch(ai, batch, feedbacks)
		if err != nil {
			fmt.Printf("   ⚠️  警告：Story Tabs 重试第 %d 次调用失败: %v\n", attempt, err)
			break
		}
		anyImproved := false
		for pos, tabs := range results {
			m := batch[pos]
			group := &groups[m.GroupIndex-1]
			candidate, rejected := normalizeStoryTabsWithReasons(*group, tabs)
			if betterStoryTabs(*group, candidate, group.Tabs) {
				group.Tabs = candidate
				group.lastRejected = rejected
				anyImproved = true
			}
		}

		batch, feedbacks = collectStoryTabRetries(groups, batch)
		if len(batch) == 0 || !anyImproved {
			break
		}
	}
	return calls
}

// tabRejectionFeedbacks 把 rejectedTab 列表转成供 prompt 使用的失败原因字符串。
func tabRejectionFeedbacks(rejected []rejectedTab) []string {
	if len(rejected) == 0 {
		return nil
	}
	reasons := make([]string, 0, len(rejected))
	for _, r := range rejected {
		if r.Reason == "" {
			continue
		}
		reasons = append(reasons, r.Reason)
	}
	return uniqueStrings(reasons)
}

// uniqueStrings 按首次出现顺序去重非空字符串。
func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
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

type storyTabsQuality struct {
	tabCount            int
	highlightCoverage   int
	evidenceCoverage    int
	nativeSubtitleCount int
}

type storyTabQualityStats struct {
	acceptedTabs       int
	subtitleFallbacks  int
	evidenceRejections int
	fallbackStories    int
}

// betterStoryTabs 按质量元组比较两个已归一化结果，确保重试不会只因数量相同而错过更可靠的版本。
func betterStoryTabs(group NewsGroup, candidate []StoryTab, current []StoryTab) bool {
	candidateQuality := measureStoryTabsQuality(group, candidate)
	currentQuality := measureStoryTabsQuality(group, current)
	candidateValues := []int{
		candidateQuality.tabCount,
		candidateQuality.highlightCoverage,
		candidateQuality.evidenceCoverage,
		candidateQuality.nativeSubtitleCount,
	}
	currentValues := []int{
		currentQuality.tabCount,
		currentQuality.highlightCoverage,
		currentQuality.evidenceCoverage,
		currentQuality.nativeSubtitleCount,
	}
	for i := range candidateValues {
		if candidateValues[i] != currentValues[i] {
			return candidateValues[i] > currentValues[i]
		}
	}
	return false
}

// measureStoryTabsQuality 统计有效 Tab 数、highlight/来源证据覆盖和原生合格字幕数量。
func measureStoryTabsQuality(group NewsGroup, tabs []StoryTab) storyTabsQuality {
	highlightIndexes := make(map[int]bool, len(group.Highlights))
	for _, highlight := range group.Highlights {
		highlightIndexes[highlight.Index] = true
	}
	coveredHighlights := make(map[int]bool)
	coveredEvidence := make(map[int]bool)
	nativeSubtitles := 0
	for _, tab := range tabs {
		if !tab.subtitleFallback {
			nativeSubtitles++
		}
		for _, index := range tab.EvidenceIndexes {
			coveredEvidence[index] = true
			if highlightIndexes[index] {
				coveredHighlights[index] = true
			}
		}
	}
	return storyTabsQuality{
		tabCount:            len(tabs),
		highlightCoverage:   len(coveredHighlights),
		evidenceCoverage:    len(coveredEvidence),
		nativeSubtitleCount: nativeSubtitles,
	}
}

// collectStoryTabQualityStats 汇总写入本地 fallback 前的质量指标，便于观察 prompt 调整后的收益与成本。
func collectStoryTabQualityStats(groups []NewsGroup) storyTabQualityStats {
	var stats storyTabQualityStats
	for _, group := range groups {
		stats.acceptedTabs += len(group.Tabs)
		if len(group.Tabs) < minStoryTabs {
			stats.fallbackStories++
		}
		for _, tab := range group.Tabs {
			if tab.subtitleFallback {
				stats.subtitleFallbacks++
			}
		}
		for _, rejected := range group.lastRejected {
			if strings.Contains(rejected.Reason, "evidence_indexes") {
				stats.evidenceRejections++
			}
		}
	}
	return stats
}
