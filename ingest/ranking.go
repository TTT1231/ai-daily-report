package main

import (
	"sort"
	"strings"
)

// applyKeywordWeights 把模型评分与代码层关键词保底分合并：
// 先用确定性门槛剔除不合格条目，再用关键词规则补回模型可能漏掉的重点内容，最终按分排序并截断。
func applyKeywordWeights(preferences PreferencesConfig, scored []ScoredItem, items []Item) []ScoredItem {
	byIndex := make(map[int]ScoredItem, len(scored))
	for _, item := range scored {
		if item.Index < 1 || item.Index > len(items) {
			continue
		}
		title := items[item.Index-1].Title
		if !passesDeterministicInterestGate(preferences, title, item.Score) {
			continue
		}
		item.Title = title
		item.Score = min(item.Score, 10)
		byIndex[item.Index] = item
	}

	for i, item := range items {
		index := i + 1
		keywordScore, reason := keywordInterestScore(preferences, item.Title)
		if keywordScore < preferences.Thresholds.MinimumScore {
			continue
		}
		current, exists := byIndex[index]
		if !exists {
			current = ScoredItem{Index: index, Title: item.Title, Score: keywordScore, Reason: reason}
		} else if keywordScore > current.Score {
			current.Score = keywordScore
			current.Reason = reason
		}
		current.KeywordScore = keywordScore
		byIndex[index] = current
	}

	result := make([]ScoredItem, 0, len(byIndex))
	for _, item := range byIndex {
		if item.Score >= preferences.Thresholds.MinimumScore {
			result = append(result, item)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Score == result[j].Score {
			return result[i].KeywordScore > result[j].KeywordScore
		}
		return result[i].Score > result[j].Score
	})
	if len(result) > preferences.Thresholds.MaximumCandidates {
		result = result[:preferences.Thresholds.MaximumCandidates]
	}
	return result
}

// passesDeterministicInterestGate 判断标题是否通过确定性兴趣门槛：
// 硬排除营销/地缘政治内容；重点品牌直接放行；其余只有同时命中 AI 与重大政策、或属高风险中转才放行。
func passesDeterministicInterestGate(preferences PreferencesConfig, title string, modelScore int) bool {
	if isHardExcludedTitle(preferences, title) {
		return false
	}
	lower := strings.ToLower(title)
	if containsAny(lower, preferences.Signals.PriorityKeywords...) {
		return true
	}
	priorityBrand := containsAny(lower, preferences.priorityAliases()...)
	if priorityBrand {
		return true
	}

	aiTerms := containsAny(lower, preferences.Signals.AITerms...)
	majorPolicy := containsAny(lower, preferences.Signals.MajorPolicy...)
	if aiTerms && majorPolicy {
		return true
	}

	intermediary := containsAny(lower, preferences.Signals.IntermediaryTerms...)
	intermediaryRisk := containsAny(lower, preferences.Signals.RiskEvents...)
	if intermediary {
		return intermediaryRisk
	}

	// 非重点厂商只有达到极高重要性且明确属于 AI 行业级事件时才保留。
	majorIndustryChange := aiTerms && containsAny(lower, preferences.Signals.MajorIndustryChanges...)
	return modelScore >= 9 && majorIndustryChange
}

// keywordInterestScore 按关键词规则为标题打一个 0-10 的保底分并给出理由，
// 用于在模型漏报或调用失败时仍能召回用户关注的内容。
func keywordInterestScore(preferences PreferencesConfig, title string) (int, string) {
	lower := strings.ToLower(title)
	if isHardExcludedTitle(preferences, title) {
		return 0, ""
	}
	riskNews := containsAny(lower, preferences.Signals.RiskEvents...)
	promotion := containsAny(lower, preferences.Dislikes.Marketing...)
	if promotion && !riskNews {
		return 0, ""
	}
	aiTerms := containsAny(lower, preferences.Signals.AITerms...)
	majorPolicy := containsAny(lower, preferences.Signals.MajorPolicy...)
	if aiTerms && majorPolicy {
		return 10, "命中国家级 AI 政策与监管关键词，属于必须关注的行业变化"
	}
	if containsAny(lower, preferences.Signals.PriorityKeywords...) {
		return 9, "命中用户自定义的直接加分关键词，代码层提高优先级以避免漏报"
	}
	if riskNews && containsAny(lower, preferences.Signals.IntermediaryProducts...) {
		return 8, "命中 AI 服务、中转或账号风险关键词，具有直接使用风险"
	}
	priorityBrand := containsAny(lower, preferences.priorityAliases()...)
	if !priorityBrand {
		return 0, ""
	}
	strongChange := containsAny(lower, preferences.Signals.ImportantChanges...)
	if strongChange {
		return 9, "命中重点 AI 厂商及产品变化关键词，代码层提高优先级以避免漏报"
	}
	return 6, "命中用户重点关注的 AI 厂商或产品关键词，但缺少明确产品变化信号"
}

// isHardExcludedTitle 判断标题是否应被无条件排除：纯营销推广（非风险类）或纯地缘政治表态（无产品影响）。
func isHardExcludedTitle(preferences PreferencesConfig, title string) bool {
	lower := strings.ToLower(title)
	if containsAny(lower, preferences.Dislikes.HardExclude...) {
		return true
	}
	marketing := containsAny(lower, preferences.Dislikes.Marketing...)
	riskNews := containsAny(lower, preferences.Signals.RiskEvents...)
	if marketing && !riskNews {
		return true
	}
	geopolitics := containsAny(lower, preferences.Dislikes.Geopolitics...)
	productImpact := containsAny(lower, preferences.Signals.ProductImpact...)
	return geopolitics && !productImpact
}

// containsAny 报告 text 是否包含任意一个给定子串，是关键词匹配的基础工具。
func containsAny(text string, terms ...string) bool {
	for _, term := range terms {
		if term = strings.TrimSpace(term); term != "" && strings.Contains(text, term) {
			return true
		}
	}
	return false
}
