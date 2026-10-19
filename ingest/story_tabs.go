package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// generateStoryTabs 让模型根据来源正文为每个 Story 编排 1-6 个视频 Tab，并另外
// 生成按事件理解所需分段的 Story 级口播。Tab 是编辑摘要，Scene 是实际朗读，两者不一一对应。
//
// pickedGroupIndexes 标记哪些 group 是人工 pick 的（key 是 groups 的下标）：
//
//	非 picked 且 Tab 不足 → 直接剔除（不凑数、不重试，原逻辑）。
//	picked 且质量不达标  → 在两轮定向重写后跳过并明确警告，不让单条失败中止整期。
func generateStoryTabs(ai AIConfig, groups []NewsGroup, items []Item, pickedGroupIndexes map[int]bool) ([]NewsGroup, error) {
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
	var repairBatch []storyTabMaterial
	for start := 0; start < len(materials); start += storyTabBatchSize {
		end := min(start+storyTabBatchSize, len(materials))
		batch := materials[start:end]
		results, err := requestStoryTabsBatchWithRetry(ai, batch)
		if err != nil {
			return groups, err
		}
		repairBatch = append(repairBatch, applyStoryTabsResults(groups, batch, results)...)
	}
	for repairAttempt := 1; repairAttempt <= 2 && len(repairBatch) > 0; repairAttempt++ {
		fmt.Printf("   ↻ %d 个 Story 的内容未通过质量校验，正在进行第 %d 轮定向重写\n", len(repairBatch), repairAttempt)
		var nextRepairBatch []storyTabMaterial
		for start := 0; start < len(repairBatch); start += storyTabBatchSize {
			end := min(start+storyTabBatchSize, len(repairBatch))
			batch := repairBatch[start:end]
			repaired, repairErr := requestStoryTabsBatchWithRetry(ai, batch)
			if repairErr != nil {
				return groups, repairErr
			}
			nextRepairBatch = append(nextRepairBatch, applyStoryTabsResults(groups, batch, repaired)...)
		}
		repairBatch = nextRepairBatch
	}

	// 最终质量闸：任何不合格 Story 都不会进入成片。人工 pick 也不使用原文碎片
	// 静默补齐；两轮定向重写后仍失败则逐条跳过并警告，避免拖垮其它合格 picks。
	kept := make([]NewsGroup, 0, len(groups))
	var dropped int
	for i, g := range groups {
		if !storyTabsContentReady(g) {
			if pickedGroupIndexes != nil && pickedGroupIndexes[i] {
				fmt.Printf("   ⚠️  pick story %q 在两轮定向重写后仍未通过质量线（Tabs=%d，Scenes=%d），已跳过\n",
					g.Title, len(g.Tabs), len(g.Scenes))
				dropped++
				continue
			}
			fmt.Printf("   ⚠️  story %q 未达到内容质量线（Tabs=%d，Scenes=%d），已剔除\n", g.Title, len(g.Tabs), len(g.Scenes))
			dropped++
			continue
		}
		kept = append(kept, g)
	}
	if len(kept) == 0 {
		return nil, fmt.Errorf("所有 Story 的 Tabs/Scenes 均未通过质量线，无法成片（检查 prompt、模型或来源质量）")
	}
	if dropped > 0 {
		fmt.Printf("   完成：保留 %d / %d 个 Story（剔除 %d 个质量不合格项，不做降级补齐）\n",
			len(kept), len(groups), dropped)
	} else {
		fmt.Printf("   完成：保留 %d / %d 个 Story\n", len(kept), len(groups))
	}
	return kept, nil
}

func storyTabsContentReady(group NewsGroup) bool {
	return len(group.Tabs) >= minStoryTabs && len(group.Tabs) <= maxStoryTabs &&
		len(group.Scenes) >= 1 && len(group.Scenes) <= maxStoryScenes &&
		resolvedContentTitle(group) != "" &&
		(!group.NavigationTitleRequired || resolvedNavigationTitle(group) != "") &&
		len(narrationRejectionReasons(group)) == 0
}

// storyTabMaterial 缓存单个 Story 送给模型的材料文本及其全局序号，便于重试时复用。
type storyTabMaterial struct {
	GroupIndex int
	Body       string
}

// requestStoryTabsBatchWithRetry 调用 requestStoryTabsBatch，对瞬时失败（限流/5xx/网络）
// 退避重试，避免单批次抖动直接让整段请求失败。
func requestStoryTabsBatchWithRetry(ai AIConfig, batch []storyTabMaterial) ([]StoryTabsResult, error) {
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
func requestStoryTabsBatch(ai AIConfig, batch []storyTabMaterial) ([]StoryTabsResult, error) {
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

	out := make([]StoryTabsResult, len(batch))
	for _, result := range results {
		pos := batchPositionByIndex(batch, result.GroupIndex)
		if pos < 0 {
			continue
		}
		out[pos] = result
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

// buildStoryTabsPrompt 构造批次 prompt，先写连贯新闻口播，再组织 Tabs。
func buildStoryTabsPrompt(batch []storyTabMaterial) string {
	return fmt.Sprintf(`请按主持人编辑规则，为以下 %d 个 Story 先确定新闻重点并写完整口播，再分段和整理 Tabs。只听声音也必须理解原始选题，不依赖标题、图片或卡片补核心内容。

每个 Story：%d 至 %d 张 Tab；summary 至少 %d 个可见字符、目标25至80、纯文本与格式化视觉占用均最多 %d。口播 1 至 %d 段，每段28至96字，段数和篇幅服从理解需要；简单消息简讲，复杂事件展开，不统一成标题加免责尾句。

只返回以下 JSON 数组：
[
  {
    "group_index": Story全局序号,
    "content_title": "主体与核心事件的完整新闻标题，最多30字",
    "navigation_title": "可完整展示的实体、产品或对象短标签",
    "scenes": [
      {"subtitle": "完整口播的自然分段，后句承接前句解释关键内容", "evidence_indexes": [支撑该段的来源序号]}
    ],
    "narration_review": {
      "takeaway": "观众听完最该记住的具体事件或变化",
      "core_facts": [
        {"fact": "支撑原始选题且不可遗漏的完整事实", "spoken_evidence": "逐字引用最终某个Scene里实际解释该事实的原句或分句", "evidence_indexes": [该原句所用的来源序号]}
      ]
    },
    "tabs": [
      {"title": "该卡具体主题", "summary": "完整事实句；一段粗体突出重点，英文专名使用行内代码", "kind": "fact、impact或watch", "evidence_indexes": [支撑该卡的来源序号]}
    ]
  }
]

Story 材料：
%s

group_index 照抄材料中的全局序号。narration_review列出需要讲出的核心事实，不能以只在Tabs出现的句子或空泛自我评价冒充实际口播。`, len(batch), minStoryTabs, maxStoryTabs, minTabSummaryRunes, maxTabSummaryVisibleRunes, maxStoryScenes, joinMaterialBodies(batch))
}

// joinMaterialBodies 把批次内各 Story 材料正文用空行拼接。
func joinMaterialBodies(batch []storyTabMaterial) string {
	bodies := make([]string, 0, len(batch))
	for _, m := range batch {
		bodies = append(bodies, m.Body)
	}
	return strings.Join(bodies, "\n\n")
}

// applyStoryTabsResults 把批次请求结果归一化后写入对应 Story，并为未达到质量线的
// Story 生成带精确拒绝原因的重写材料。这样“超长/过短/重复/证据序号错误”会先回到
// 模型修正，而不是直接进入确定性降级。
func applyStoryTabsResults(groups []NewsGroup, batch []storyTabMaterial, results []StoryTabsResult) []storyTabMaterial {
	var repairs []storyTabMaterial
	for pos, result := range results {
		if pos < 0 || pos >= len(batch) {
			continue
		}
		group := &groups[batch[pos].GroupIndex-1]
		if storyTabsContentReady(*group) {
			continue
		}
		// A repaired Story is one coherent version. Never combine old Tabs with
		// a new title/narration, or silently keep only the surviving sentences.
		candidate := *group
		candidate.NavigationTitleRequired = true
		candidate.ContentTitle = cleanContentTitle(result.ContentTitle, group.Title)
		candidate.NavigationTitle = cleanNavigationTitle(result.NavigationTitle)
		normalized, rejected := normalizeStoryTabsWithReasons(candidate, result.Tabs)
		normalizedScenes, rejectedScenes := normalizeStoryScenesWithReasons(candidate, result.Scenes)
		candidate.Tabs = normalized
		candidate.Scenes = normalizedScenes
		candidate.NarrationReview = result.NarrationReview
		resolvedTitle := resolvedContentTitle(candidate)
		resolvedNavigation := resolvedNavigationTitle(candidate)
		tabsReady := len(candidate.Tabs) >= minStoryTabs && len(result.Tabs) <= maxStoryTabs && len(rejected) == 0
		scenesReady := len(candidate.Scenes) >= 1 && len(result.Scenes) <= maxStoryScenes && len(rejectedScenes) == 0
		navigationReady := resolvedNavigation != ""
		narrationIssues := narrationRejectionReasons(candidate)
		if tabsReady && scenesReady && resolvedTitle != "" && navigationReady && len(narrationIssues) == 0 {
			*group = candidate
			continue
		}
		var reasons []string
		if !tabsReady {
			for _, rejection := range rejected {
				title := strings.TrimSpace(rejection.Tab.Title)
				if title == "" {
					title = "未命名 Tab"
				}
				reasons = append(reasons, fmt.Sprintf("- %s：%s", title, rejection.Reason))
			}
			if len(result.Tabs) == 0 {
				reasons = append(reasons, "- 模型没有返回任何 Tab")
			}
			reasons = append(reasons, fmt.Sprintf("- 本轮有 %d 个有效 Tab；完整结果必须含 %d 至 %d 个有效且互不重复的信息卡", len(candidate.Tabs), minStoryTabs, maxStoryTabs))
		}
		if !scenesReady {
			for _, rejection := range rejectedScenes {
				reasons = append(reasons, "- Scene："+rejection)
			}
			reasons = append(reasons, fmt.Sprintf("- 本轮口播有缺失、无效或超限段落；必须完整生成 1 至 %d 条连贯口播，讲清核心事件、实质内容与必要条件", maxStoryScenes))
		}
		for _, issue := range narrationIssues {
			reasons = append(reasons, "- "+issue)
		}
		if resolvedTitle == "" {
			reasons = append(reasons, fmt.Sprintf("- content_title 不合格：先剥离快讯、慢讯、第一人称叙述等论坛前缀；清洗后为完整新闻标题且能放下时直接复用，否则必须语义改写为最多 %d 字的完整短标题，不得截取前缀或使用省略号", maxContentTitleRunes))
		}
		if !navigationReady {
			reasons = append(reasons, fmt.Sprintf("- navigation_title 不合格：必须改写成可完整显示的语义标签，中文约 2 至 5 字或同等宽度英文（视觉宽度最多 %.1f），只保留实体/产品/对象，不得截断或使用省略号", maxNavigationTitleUnits))
		}
		repairBody := fmt.Sprintf(`%s

上一轮输出未通过程序质量校验：
%s

请基于原材料重写同一个完整版本：content_title、navigation_title、全部 Scenes、narration_review 和 Tabs，不能只补字段或沿用旧卡片。先确定观众应记住什么，再连贯讲清核心事实；复杂事件按理解需要分成1至%d段，不能以标题一句加免责尾句代替讲解。content_title最多%d字，不截断或缩窄选题；summary按系统规则格式化，最多%d个可见字符与视觉单位。narration_review逐项引用本轮实际口播及其来源；来源不足时不要编造。`,
			batch[pos].Body, strings.Join(reasons, "\n"), maxStoryScenes, maxContentTitleRunes, maxTabSummaryVisibleRunes)
		repairs = append(repairs, storyTabMaterial{GroupIndex: batch[pos].GroupIndex, Body: repairBody})
	}
	return repairs
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
