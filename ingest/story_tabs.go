package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// generateStoryTabs 让模型根据来源正文为每个 Story 编排 2-6 个视频 Tab，并另外
// 生成 1-2 条 Story 级精简口播。Tab 是画面信息，Scene 是实际朗读，两者不一一对应。
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
	return len(group.Tabs) >= minStoryTabs &&
		len(group.Scenes) >= 1 && len(group.Scenes) <= maxStoryScenes &&
		resolvedContentTitle(group) != "" &&
		(!group.NavigationTitleRequired || resolvedNavigationTitle(group) != "")
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

// buildStoryTabsPrompt 构造批次 prompt，要求模型为每个 Story 生成 Tabs。
func buildStoryTabsPrompt(batch []storyTabMaterial) string {
	return fmt.Sprintf(`请为以下 %d 个 Story 分别生成 %d 至 %d 个适合短视频展示的 Tabs。
每个 summary 至少 %d 个汉字，目标长度 25 至 80 个可见字符，纯文本硬性上限 %d 个可见字符；Markdown 加权后的视觉占用也不得超过同一上限。每张卡必须恰当使用一段且最多一段粗体突出核心变化、机制、影响或结论；出现多个英文产品/API/错误码/版本时，可用多段行内代码分别标出实际出现且有辨识价值的专名，不要重复标记或装饰普通英文单词。先提炼值得展示的独立事实，再决定 Tabs 数量；一张卡写不完时增加 Tab，禁止硬截句子、复制正文或按原文段落数机械补满 6 张。第一张 Tab 必须直接解释标题里的核心事件，背景信息放后面。
另外为每个 Story 生成 1 至 %d 个 scenes：按来源证据的信息量决定段数，复杂图表可用多段连续解释，总数不超过 %d 个，不按图片数量机械配额。全部 Scene 连起来必须讲清标题承诺的核心事件、关键事实及限定条件，不对应单张 Tab、不得逐卡朗读。每段都需要匹配来源证据，不能插入无图段帮助读卡；不靠一句标题或统一短时长省略必要讲解。
遇到多个很长的模型名、API 名或版本号时，不要逐项穷举清单；优先概括系列名、覆盖范围、数量、参数区间和 1 至 2 个代表例，避免行内代码标签堆满卡片。

严格返回以下 JSON，不要返回其他内容：
[
  {
    "group_index": Story 序号,
	"content_title": "先剥离快讯、慢讯、详细对比了一下等论坛前缀及无意义句尾标点；清洗后不超过30字符、完整且为新闻标题风格时直接复用，否则改写为主体+核心事件或结论的完整短标题，改写目标12至26字符、硬性最多30字符，不得截前缀或使用省略号",
	"navigation_title": "底部时间线语义标签，不是新闻句缩写；只保留最有辨识度的实体、产品或对象，中文通常2至5字，英文按显示宽度可略长，不得添加无必要尾巴、复制完整标题或使用省略号",
    "tabs": [
      {
        "title": "简短 Tab 标题",
        "summary": "25至80个可见字符的完整描述（硬性最多110字）；重要信息（数字/日期/价格/关键结论）用粗体，模型/产品/API/错误码/版本等专有名用行内代码",
        "kind": "fact、impact 或 watch",
        "evidence_indexes": [支撑该 Tab 的来源序号]
      }
    ],
    "scenes": [
      {
        "subtitle": "28至96字的完整证据讲解，按理解所需解释主体、核心事实与范围；与前后段语义衔接，不填空凑时长",
        "evidence_indexes": [支撑该口播的来源序号]
      }
    ]
  }
]

Story 材料：
%s

group_index 必须照抄材料中的 Story 序号，不得使用当前批次内的相对序号。`, len(batch), minStoryTabs, maxStoryTabs, minTabSummaryRunes, maxTabSummaryVisibleRunes, maxStoryScenes, maxStoryScenes, joinMaterialBodies(batch))
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
		group.NavigationTitleRequired = true
		if contentTitle := cleanContentTitle(result.ContentTitle, group.Title); contentTitle != "" {
			group.ContentTitle = contentTitle
		}
		if strings.TrimSpace(result.NavigationTitle) != "" {
			if navigationTitle := cleanNavigationTitle(result.NavigationTitle); navigationTitle != "" {
				group.NavigationTitle = navigationTitle
			}
		}
		normalized, rejected := normalizeStoryTabsWithReasons(*group, result.Tabs)
		if betterStoryTabs(normalized, group.Tabs) {
			group.Tabs = normalized
		}
		normalizedScenes, rejectedScenes := normalizeStoryScenesWithReasons(*group, result.Scenes)
		if betterStoryScenes(normalizedScenes, group.Scenes) {
			group.Scenes = normalizedScenes
		}
		resolvedTitle := resolvedContentTitle(*group)
		resolvedNavigation := resolvedNavigationTitle(*group)
		tabsReady := len(group.Tabs) >= minStoryTabs
		scenesReady := len(group.Scenes) >= 1 && len(group.Scenes) <= maxStoryScenes
		navigationReady := !group.NavigationTitleRequired || resolvedNavigation != ""
		if tabsReady && scenesReady && resolvedTitle != "" && navigationReady {
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
			reasons = append(reasons, fmt.Sprintf("- 当前最佳结果仅有 %d 个有效 Tab；至少需要 %d 个互不重复的画面信息卡", len(group.Tabs), minStoryTabs))
		}
		if !scenesReady {
			for _, rejection := range rejectedScenes {
				reasons = append(reasons, "- Scene："+rejection)
			}
			reasons = append(reasons, "- 没有有效 Scene；必须生成 1 条总结整条 Story 的简短口播，不能逐张朗读 Tab")
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

请重新生成这个 Story 的完整 content_title、navigation_title、全部 Tabs 和由来源证据决定的 1 至 6 个 Story 级 Scenes，不要只补缺失项。navigation_title 是实体/产品/对象标签，不是新闻标题缩写，必须短到可完整显示；summary 每张至少用一段且最多一段粗体突出核心变化/机制/影响，出现多个英文产品、API、错误码或版本时，可用多段行内代码分别标出实际出现且有辨识价值的专名，但粗体和行内代码不得交叉、嵌套或拆开同一英文专名。先剝离快讯、慢讯、详细对比了一下等论坛前缀及无意义句尾标点；清洗后的原标题是完整新闻标题且能在 %d 字内完整显示时，content_title 直接复用；否则必须语义改写，禁止截取原文前缀或使用省略号；summary 纯文本不得超过 %d 个可见字符，格式化后也不得超过同一视觉容量。若内容放不下，增加 Tab 并按独立事实拆分，禁止截断、复制正文或按段落凑满 6 张；事实不足以支撑两个独立 Tab 时宁可返回一个让质量闸剔除，不得编造第二个角度；Scene 必须总结整条新闻，不得与 Tabs 一一对应；evidence_indexes 只能使用材料给出的来源序号。`,
			batch[pos].Body, strings.Join(reasons, "\n"), maxContentTitleRunes, maxTabSummaryVisibleRunes)
		repairs = append(repairs, storyTabMaterial{GroupIndex: batch[pos].GroupIndex, Body: repairBody})
	}
	return repairs
}

func betterStoryTabs(candidate, current []StoryTab) bool {
	candidateReady := len(candidate) >= minStoryTabs
	currentReady := len(current) >= minStoryTabs
	if candidateReady != currentReady {
		return candidateReady
	}
	if currentReady {
		return false
	}
	return len(candidate) > len(current)
}

func betterStoryScenes(candidate, current []StoryScene) bool {
	candidateReady := len(candidate) >= 1 && len(candidate) <= 2
	currentReady := len(current) >= 1 && len(current) <= 2
	if candidateReady != currentReady {
		return candidateReady
	}
	if currentReady {
		return false
	}
	return len(candidate) > len(current)
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
