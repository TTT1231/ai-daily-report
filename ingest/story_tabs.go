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
		results, err := requestStoryTabsBatchWithRetry(ai, batch)
		if err != nil {
			return groups, err
		}
		applyStoryTabsResults(groups, batch, results)
	}

	// 校验后直接剔除 AI 给不出 minStoryTabs 个合格 Tab 的 Story——不重试、不补 filler：
	// 重试对「来源太薄/模型给不出」意义不大；补 filler 会发低质内容；剔除既不发低质，又不让单条卡掉整期。
	kept := make([]NewsGroup, 0, len(groups))
	for _, g := range groups {
		if len(g.Tabs) < minStoryTabs {
			fmt.Printf("   ⚠️  story %q 只有 %d 个有效 AI Tab，已剔除（不凑数、不重试）\n", g.Title, len(g.Tabs))
			continue
		}
		kept = append(kept, g)
	}
	if len(kept) == 0 {
		return groups, fmt.Errorf("所有 Story 的 AI Tabs 均不足 %d 个，无法成片（检查 prompt/模型/来源质量）", minStoryTabs)
	}
	fmt.Printf("   完成：保留 %d / %d 个 Story（剔除 %d 个 Tab 不足）\n", len(kept), len(groups), len(groups)-len(kept))
	return kept, nil
}

// storyTabMaterial 缓存单个 Story 送给模型的材料文本及其全局序号，便于重试时复用。
type storyTabMaterial struct {
	GroupIndex int
	Body       string
}

// requestStoryTabsBatchWithRetry 调用 requestStoryTabsBatch，对瞬时失败（限流/5xx/网络）
// 退避重试，避免单批次抖动直接让整段请求失败。
func requestStoryTabsBatchWithRetry(ai AIConfig, batch []storyTabMaterial) ([][]StoryTab, error) {
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		results, err := requestStoryTabsBatch(ai, batch)
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
func requestStoryTabsBatch(ai AIConfig, batch []storyTabMaterial) ([][]StoryTab, error) {
	prompt := buildStoryTabsPrompt(batch)
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

// buildStoryTabsPrompt 构造批次 prompt，要求模型为每个 Story 生成 Tabs。
func buildStoryTabsPrompt(batch []storyTabMaterial) string {
	return fmt.Sprintf(`请为以下 %d 个 Story 分别生成 %d 至 %d 个适合短视频展示的 Tabs。
每个 summary 至少 %d 个汉字，目标长度 25 至 80 个可见字符，硬性上限 110 个可见字符；超过 110 个可见字符会被判为不合格。先完整覆盖来源中的独立事实，再决定 Tabs 数量；只有来源确实不超过两个独立事实时才使用两个 Tabs，不得虚构事实或用重复内容凑数。
遇到多个很长的模型名、API 名或版本号时，不要逐项穷举清单；优先概括系列名、覆盖范围、数量、参数区间和 1 至 2 个代表例，避免行内代码标签堆满卡片。

严格返回以下 JSON，不要返回其他内容：
[
  {
    "group_index": Story 序号,
    "tabs": [
      {
        "title": "简短 Tab 标题",
        "summary": "25至80个可见字符的完整描述（硬性最多110字）；重要信息（数字/日期/价格/关键结论）用粗体，模型/产品/API/错误码/版本等专有名用行内代码",
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
}

// joinMaterialBodies 把批次内各 Story 材料正文用空行拼接。
func joinMaterialBodies(batch []storyTabMaterial) string {
	bodies := make([]string, 0, len(batch))
	for _, m := range batch {
		bodies = append(bodies, m.Body)
	}
	return strings.Join(bodies, "\n\n")
}

// applyStoryTabsResults 把批次请求结果归一化后写入对应 Story。
func applyStoryTabsResults(groups []NewsGroup, batch []storyTabMaterial, results [][]StoryTab) {
	for pos, tabs := range results {
		if pos < 0 || pos >= len(batch) {
			continue
		}
		group := &groups[batch[pos].GroupIndex-1]
		group.Tabs = normalizeStoryTabs(*group, tabs)
	}
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
