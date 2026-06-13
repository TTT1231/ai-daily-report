package main

import (
	"sort"
	"strings"
)

// applyKeywordWeights 把模型评分与代码层关键词保底分合并：
// 先用确定性门槛剔除不合格条目，再用关键词规则补回模型可能漏掉的重点内容，最终按分排序并截断。
func applyKeywordWeights(scored []ScoredItem, items []Item) []ScoredItem {
	byIndex := make(map[int]ScoredItem, len(scored))
	for _, item := range scored {
		if item.Index < 1 || item.Index > len(items) {
			continue
		}
		title := items[item.Index-1].Title
		if !passesDeterministicInterestGate(title, item.Score) {
			continue
		}
		item.Title = title
		item.Score = min(item.Score, 10)
		byIndex[item.Index] = item
	}

	for i, item := range items {
		index := i + 1
		keywordScore, reason := keywordInterestScore(item.Title)
		if keywordScore < minInterestingScore {
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
		if item.Score >= minInterestingScore {
			result = append(result, item)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Score == result[j].Score {
			return result[i].KeywordScore > result[j].KeywordScore
		}
		return result[i].Score > result[j].Score
	})
	if len(result) > maxCandidates {
		result = result[:maxCandidates]
	}
	return result
}

// passesDeterministicInterestGate 判断标题是否通过确定性兴趣门槛：
// 硬排除营销/地缘政治内容；重点品牌直接放行；其余只有同时命中 AI 与重大政策、或属高风险中转才放行。
func passesDeterministicInterestGate(title string, modelScore int) bool {
	if isHardExcludedTitle(title) {
		return false
	}
	lower := strings.ToLower(title)
	priorityBrand := containsAny(lower,
		"openai", "chatgpt", "gpt", "codex", "智谱", "glm",
		"kimi", "月之暗面", "moonshot", "claude", "anthropic",
		"deepseek", "深度求索", "qwen", "qween", "通义千问", "阿里云百炼", "阿里百炼",
	)
	if priorityBrand {
		return true
	}

	aiTerms := containsAny(lower, "ai", "人工智能", "大模型", "模型", "算法")
	majorPolicy := containsAny(lower,
		"中央网信办", "国家网信办", "网信办", "国务院", "工信部",
		"清朗", "专项行动", "监管", "举报专区", "合规治理",
	)
	if aiTerms && majorPolicy {
		return true
	}

	intermediary := containsAny(lower, "中转", "低价ai", "低价gpt", "低价claude", "代充", "拼车")
	intermediaryRisk := containsAny(lower,
		"跑路", "诈骗", "封号", "被封", "风控", "关停", "停止服务",
		"不可用", "上游限制", "余额无法", "掉订阅", "黑冲",
	)
	if intermediary {
		return intermediaryRisk
	}

	// 非重点厂商只有达到极高重要性且明确属于 AI 行业级事件时才保留。
	majorIndustryChange := aiTerms && containsAny(lower,
		"重大收购", "合并", "国家标准", "行业标准", "全面禁止", "正式开源",
		"发布新模型", "发布并开源",
	)
	return modelScore >= 9 && majorIndustryChange
}

// keywordInterestScore 按关键词规则为标题打一个 0-10 的保底分并给出理由，
// 用于在模型漏报或调用失败时仍能召回用户关注的内容。
func keywordInterestScore(title string) (int, string) {
	lower := strings.ToLower(title)
	if isHardExcludedTitle(title) {
		return 0, ""
	}
	riskNews := containsAny(lower,
		"跑路", "诈骗", "封号", "被封", "杀号", "风控", "关停", "关闭服务",
		"停止服务", "不可用", "上游限制", "余额无法", "掉订阅", "黑冲",
	)
	promotion := containsAny(lower,
		"低价", "超低价", "限时优惠", "注册送", "拼车", "代充", "代购",
		"售卖", "出售", "购买", "返利", "邀请码", "推广", "渠道招募", "抢万亿token",
	)
	if promotion && !riskNews {
		return 0, ""
	}
	aiTerms := containsAny(lower, "ai", "人工智能", "大模型", "模型", "算法")
	majorPolicy := containsAny(lower,
		"中央网信办", "国家网信办", "网信办", "国务院", "工信部",
		"清朗", "专项行动", "监管", "举报专区", "合规治理",
	)
	if aiTerms && majorPolicy {
		return 10, "命中国家级 AI 政策与监管关键词，属于必须关注的行业变化"
	}
	if riskNews && containsAny(lower, "api", "中转", "gpt", "claude", "plus", "pro", "订阅") {
		return 8, "命中 AI 服务、中转或账号风险关键词，具有直接使用风险"
	}
	priorityBrand := containsAny(lower,
		"openai", "chatgpt", "gpt", "codex", "智谱", "glm",
		"kimi", "月之暗面", "moonshot", "claude", "anthropic",
		"deepseek", "深度求索", "qwen", "qween", "通义千问", "阿里云百炼", "阿里百炼",
	)
	if !priorityBrand {
		return 0, ""
	}
	strongChange := containsAny(lower,
		"发布", "开源", "上线", "开放", "api", "内测", "公测", "模型", "版本",
		"额度", "限额", "重置", "涨价", "降价", "价格", "消耗", "倍率",
		"封号", "被封", "风控", "收购", "agent", "智能体", "套餐", "规则",
		"信用卡", "服务", "功能", "更新",
	)
	if strongChange {
		return 9, "命中重点 AI 厂商及产品变化关键词，代码层提高优先级以避免漏报"
	}
	return 6, "命中用户重点关注的 AI 厂商或产品关键词，但缺少明确产品变化信号"
}

// isHardExcludedTitle 判断标题是否应被无条件排除：纯营销推广（非风险类）或纯地缘政治表态（无产品影响）。
func isHardExcludedTitle(title string) bool {
	lower := strings.ToLower(title)
	marketing := containsAny(lower,
		"限时优惠", "注册送", "拼车", "代充", "代购", "售卖", "出售", "返利",
		"邀请码", "推广", "抽奖", "竞猜", "预测冠军", "抢万亿token", "签到送",
		"拉新", "邀请有礼",
	)
	riskNews := containsAny(lower,
		"跑路", "诈骗", "封号", "被封", "杀号", "风控", "关停", "关闭服务",
		"停止服务", "不可用", "上游限制", "余额无法", "掉订阅", "黑冲",
	)
	if marketing && !riskNews {
		return true
	}
	geopolitics := containsAny(lower,
		"地缘政治", "国家竞争", "中美竞争", "中美关系", "国际关系", "政治表态",
		"煽动", "舆论操纵", "影响美国", "削弱美国", "中国关联", "与中国有关联",
		"政治宣传", "政府指控", "制裁",
	)
	productImpact := containsAny(lower,
		"api", "发布", "开源", "上线", "额度", "限额", "重置", "价格",
		"涨价", "降价", "内测", "公测", "封号", "被封", "服务关停",
		"禁用", "不可用", "停止服务", "禁止使用",
	)
	return geopolitics && !productImpact
}

// containsAny 报告 text 是否包含任意一个给定子串，是关键词匹配的基础工具。
func containsAny(text string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(text, term) {
			return true
		}
	}
	return false
}
