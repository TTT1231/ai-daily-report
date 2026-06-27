package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// groupSimilarNews 让模型把候选新闻聚类去重，整理成最多 maxGroups 个适合视频展示的 Story（含要点与来源序号）。
func groupSimilarNews(ai AIConfig, scored []ScoredItem, items []Item) ([]NewsGroup, error) {
	groupLimit := maxStoryGroupsForNavigation()
	var candidates []string
	for _, item := range scored {
		keywordNote := ""
		if item.KeywordScore > 0 {
			keywordNote = fmt.Sprintf("；关键词保底=%d", item.KeywordScore)
		}
		candidates = append(candidates, fmt.Sprintf(
			"%d. [%d/10%s] %s；入选理由：%s",
			item.Index, item.Score, keywordNote, item.Title, item.Reason,
		))
	}

	prompt := fmt.Sprintf(`请将以下 %d 条候选新闻聚类、去除纯重复信息，并整理为最多 %d 个适合视频展示的 Story。
每个 Story 最多保留 %d 个互不重复的 highlights。

严格返回以下 JSON 格式，不要返回其他内容：
[
  {
    "title": "合并后的 Story 标题",
    "navigation_title": "简洁的时间线短标题",
    "score": 1-10,
    "reason": "为什么值得关注",
    "source_indexes": [归入本 Story 的所有候选序号],
    "highlights": [
      {"index": 最能代表该要点的候选序号, "point": "一个不重复的具体信息点"}
    ]
  }
]

候选新闻：
%s`, len(scored), groupLimit, maxGroupHighlights, strings.Join(candidates, "\n"))

	messages := []ChatMessage{
		{Role: "system", Content: newsGroupingSystemPrompt},
		{Role: "user", Content: prompt},
	}

	// 对瞬时失败（限流/5xx/网络）和模型返回坏 JSON 都退避重试，与评分路径 recoverScoredItems
	// 的容错意图对齐：单次抖动不再直接整段丢弃聚类成果、回退到本地启发式。
	const maxAttempts = 3
	var groups []NewsGroup
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		content, err := requestModel(ai, messages)
		if err != nil {
			if attempt == maxAttempts {
				return nil, err
			}
			wait := time.Duration(attempt) * 5 * time.Second
			fmt.Printf("   ⚠️  警告：聚类请求第 %d 次失败，等待 %v 后重试: %v\n", attempt, wait, err)
			time.Sleep(wait)
			continue
		}
		if err := json.Unmarshal([]byte(extractJSON(content)), &groups); err != nil {
			if attempt == maxAttempts {
				return nil, fmt.Errorf("解析聚类 JSON 失败: %w\n原始内容: %s", err, content)
			}
			wait := time.Duration(attempt) * 5 * time.Second
			fmt.Printf("   ⚠️  警告：聚类 JSON 第 %d 次解析失败，等待 %v 后重试\n", attempt, wait)
			time.Sleep(wait)
			continue
		}
		return normalizeGroups(groups, scored, items), nil
	}
	return nil, fmt.Errorf("聚类重试 %d 次仍未成功", maxAttempts)
}

// normalizeGroups 校正模型聚类结果：拆分被错误合并的来源、去重序号与要点、补全缺失字段、
// 按分数排序并截断，同时把高分关键词保底候选作为独立 Story 补回。
func normalizeGroups(groups []NewsGroup, scored []ScoredItem, items []Item) []NewsGroup {
	candidates := make(map[int]ScoredItem, len(scored))
	for _, item := range scored {
		candidates[item.Index] = item
	}
	groups = splitIncompatibleGroups(groups, candidates, items)

	covered := make(map[int]bool)
	normalized := make([]NewsGroup, 0, len(groups))
	for _, group := range groups {
		seenSources := make(map[int]bool)
		validSources := make([]int, 0, len(group.SourceIndexes))
		for _, index := range group.SourceIndexes {
			if _, ok := candidates[index]; !ok || seenSources[index] || covered[index] {
				continue
			}
			seenSources[index] = true
			validSources = append(validSources, index)
		}

		validHighlights := make([]NewsHighlight, 0, len(group.Highlights))
		seenHighlights := make(map[int]bool)
		for _, highlight := range group.Highlights {
			if _, ok := candidates[highlight.Index]; !ok || seenHighlights[highlight.Index] {
				continue
			}
			if !seenSources[highlight.Index] && !covered[highlight.Index] {
				seenSources[highlight.Index] = true
				validSources = append(validSources, highlight.Index)
			}
			if strings.TrimSpace(highlight.Point) == "" {
				highlight.Point = items[highlight.Index-1].Title
			}
			seenHighlights[highlight.Index] = true
			validHighlights = append(validHighlights, highlight)
			if len(validHighlights) == maxGroupHighlights {
				break
			}
		}
		if len(validSources) == 0 {
			continue
		}
		if len(validHighlights) == 0 {
			index := validSources[0]
			validHighlights = append(validHighlights, NewsHighlight{Index: index, Point: items[index-1].Title})
		}

		maxScore := 0
		for _, index := range validSources {
			covered[index] = true
			maxScore = max(maxScore, candidates[index].Score)
		}
		group.Score = min(max(group.Score, maxScore), 10)
		if strings.TrimSpace(group.Title) == "" {
			group.Title = items[validHighlights[0].Index-1].Title
		}
		if strings.TrimSpace(group.Reason) == "" {
			group.Reason = candidates[validHighlights[0].Index].Reason
		}
		group.SourceIndexes = validSources
		group.Highlights = validHighlights
		// 在聚类阶段就清洗 navigation_title：内容过短或空洞的清空，
		// 由下游 navigationTitle() 走品牌/事件推断降级，避免把无效短标题带到最后。
		group.NavigationTitle = cleanNavigationTitle(group.NavigationTitle)
		normalized = append(normalized, group)
	}

	for _, item := range scored {
		if item.KeywordScore < 9 || covered[item.Index] {
			continue
		}
		normalized = append(normalized, NewsGroup{
			Title:         item.Title,
			Score:         item.Score,
			Reason:        item.Reason,
			SourceIndexes: []int{item.Index},
			Highlights:    []NewsHighlight{{Index: item.Index, Point: item.Title}},
		})
	}

	sort.SliceStable(normalized, func(i, j int) bool {
		return normalized[i].Score > normalized[j].Score
	})
	groupLimit := maxStoryGroupsForNavigation()
	if len(normalized) > groupLimit {
		normalized = normalized[:groupLimit]
	}
	return normalized
}

// splitIncompatibleGroups 检查每个 Story 内来源的本地聚类身份，把被错误归到一起的来源拆成多个独立 Story，
// 避免仅因提到同一品牌就被合并。
func splitIncompatibleGroups(groups []NewsGroup, candidates map[int]ScoredItem, items []Item) []NewsGroup {
	var result []NewsGroup
	for _, group := range groups {
		partitions := make(map[string][]int)
		var keyOrder []string
		for _, index := range group.SourceIndexes {
			if _, ok := candidates[index]; !ok || index < 1 || index > len(items) {
				continue
			}
			key, _ := fallbackGroupIdentity(items[index-1].Title)
			if _, exists := partitions[key]; !exists {
				keyOrder = append(keyOrder, key)
			}
			partitions[key] = append(partitions[key], index)
		}
		if len(partitions) <= 1 {
			result = append(result, group)
			continue
		}

		for _, key := range keyOrder {
			indexes := partitions[key]
			_, fallbackTitle := fallbackGroupIdentity(items[indexes[0]-1].Title)
			partition := NewsGroup{Title: fallbackTitle, SourceIndexes: indexes}
			for _, highlight := range group.Highlights {
				if _, ok := candidates[highlight.Index]; !ok || highlight.Index < 1 || highlight.Index > len(items) {
					continue
				}
				highlightKey, _ := fallbackGroupIdentity(items[highlight.Index-1].Title)
				if highlightKey == key {
					partition.Highlights = append(partition.Highlights, highlight)
				}
			}
			result = append(result, partition)
		}
	}
	return result
}

// fallbackGroups 在模型聚类失败时的本地降级方案：按 fallbackGroupIdentity 给出的身份键就地聚合，生成 Story。
func fallbackGroups(scored []ScoredItem) []NewsGroup {
	groupByKey := make(map[string]int)
	groupLimit := maxStoryGroupsForNavigation()
	groups := make([]NewsGroup, 0, min(len(scored), groupLimit))
	for _, item := range scored {
		key, title := fallbackGroupIdentity(item.Title)
		position, exists := groupByKey[key]
		if !exists {
			groupByKey[key] = len(groups)
			groups = append(groups, NewsGroup{
				Title:         title,
				Score:         item.Score,
				Reason:        item.Reason,
				SourceIndexes: []int{item.Index},
				Highlights:    []NewsHighlight{{Index: item.Index, Point: item.Title}},
			})
			continue
		}
		group := &groups[position]
		group.SourceIndexes = append(group.SourceIndexes, item.Index)
		group.Score = max(group.Score, item.Score)
		if len(group.Highlights) < maxGroupHighlights {
			group.Highlights = append(group.Highlights, NewsHighlight{Index: item.Index, Point: item.Title})
		}
	}
	sort.SliceStable(groups, func(i, j int) bool {
		return groups[i].Score > groups[j].Score
	})
	if len(groups) > groupLimit {
		groups = groups[:groupLimit]
	}
	return groups
}

// fallbackGroupIdentity 由标题推断稳定的聚类身份键与展示标题：
// 识别重点品牌及特定事件（额度重置、账号风控等），无法识别时回退为规范化标题。
func fallbackGroupIdentity(title string) (string, string) {
	lower := strings.ToLower(title)
	brand := ""
	switch {
	case strings.Contains(lower, "codex"):
		brand = "codex"
	case containsAny(lower, "kimi", "月之暗面", "moonshot"):
		brand = "kimi"
	case containsAny(lower, "智谱", "glm"):
		brand = "glm"
	case containsAny(lower, "claude", "anthropic"):
		brand = "claude"
	case containsAny(lower, "deepseek", "深度求索"):
		brand = "deepseek"
	case containsAny(lower, "qwen", "qween", "通义千问", "阿里云百炼", "阿里百炼"):
		brand = "qwen"
	case containsAny(lower, "openai", "chatgpt", "gpt"):
		brand = "openai"
	}

	switch {
	case brand == "codex" && containsAny(lower, "重置", "额度", "限额", "rate limit"):
		return "codex-quota-reset", "Codex 额度与重置规则更新"
	case brand == "openai" && containsAny(lower, "重置", "额度", "限额", "rate limit"):
		return "codex-quota-reset", "Codex 额度与重置规则更新"
	case brand == "codex" && containsAny(lower, "cdp", "浏览器开发者模式", "browser use"):
		return "codex-browser-cdp", "Codex 浏览器开发者模式与 CDP 调试"
	case brand != "" && containsAny(lower, "封号", "被封", "杀号", "风控", "掉订阅"):
		return brand + "-account-risk", strings.ToUpper(brand) + " 账号与风控动态"
	case strings.Contains(lower, "plus") && containsAny(lower, "封号", "被封", "杀号", "风控", "掉订阅"):
		return "plus-account-risk", "Plus 账号与风控动态"
	case brand == "kimi":
		return "kimi-*", "Kimi 模型与产品动态"
	case brand == "glm":
		return "glm-*", "智谱 GLM 模型与产品动态"
	case brand == "claude":
		return "claude-*", "Anthropic Claude 模型与产品动态"
	case brand == "deepseek":
		return "deepseek-*", "DeepSeek 模型与产品动态"
	case brand == "qwen":
		return "qwen-*", "Qwen 通义千问模型与产品动态"
	}
	return normalizeTitle(title), title
}

// cleanNavigationTitle 清洗模型给出的底部时间线短标题：
// 内容过短或空洞（纯栏目名、无信息短语）时清空，交由下游 navigationTitle() 降级推断。
func cleanNavigationTitle(title string) string {
	title = strings.TrimSpace(title)
	if validNavigationTitle(title) == "" {
		return ""
	}
	if isVacuousNavigationTitle(title) {
		return ""
	}
	return stripForumDecorations(title)
}

// isVacuousNavigationTitle 判断短标题是否内容空洞：只是栏目名或通用占位词，缺少“主体+事件”。
func isVacuousNavigationTitle(title string) bool {
	lower := strings.ToLower(title)
	// 纯栏目名（与视频分区/Tab 角色同名的标签），没有具体事件信息。
	vacuous := []string{
		"事件概览", "具体变化", "用户影响", "后续观察", "后续进展",
		"事件综述", "要点总结", "内容详情", "详细内容", "最新消息", "最新动态",
		"AI", "行业动态", "AI动态", "AI新闻", "新闻速递", "新闻动态",
	}
	for _, term := range vacuous {
		if lower == strings.ToLower(term) {
			return true
		}
	}
	return false
}

// normalizeTitle 去除标题中的标点与空白并转小写，得到用于去重与聚类身份比较的规范化字符串。
func normalizeTitle(title string) string {
	replacer := strings.NewReplacer(
		" ", "", "：", "", ":", "", "，", "", ",", "", "。", "", ".", "",
		"！", "", "!", "", "？", "", "?", "", "【", "", "】", "", "[", "", "]", "",
		"（", "", "）", "", "(", "", ")", "", "-", "", "_", "",
	)
	return strings.ToLower(replacer.Replace(title))
}
