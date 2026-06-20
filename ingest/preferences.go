package main

import (
	"fmt"
	"strings"
)

type PreferencesConfig struct {
	PriorityEntities []PriorityEntity     `json:"priorityEntities"`
	Signals          PreferenceSignals    `json:"signals"`
	Dislikes         PreferenceDislikes   `json:"dislikes"`
	Guidance         PreferenceGuidance   `json:"guidance"`
	Thresholds       PreferenceThresholds `json:"thresholds"`
}

type PriorityEntity struct {
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
}

type PreferenceSignals struct {
	PriorityKeywords     []string `json:"priorityKeywords"`
	AITerms              []string `json:"aiTerms"`
	ImportantChanges     []string `json:"importantChanges"`
	RiskEvents           []string `json:"riskEvents"`
	IntermediaryTerms    []string `json:"intermediaryTerms"`
	IntermediaryProducts []string `json:"intermediaryProducts"`
	MajorPolicy          []string `json:"majorPolicy"`
	MajorIndustryChanges []string `json:"majorIndustryChanges"`
	ProductImpact        []string `json:"productImpact"`
}

type PreferenceDislikes struct {
	HardExclude []string `json:"hardExclude"`
	Marketing   []string `json:"marketing"`
	Geopolitics []string `json:"geopolitics"`
}

type PreferenceGuidance struct {
	Focus         []string `json:"focus"`
	NotInterested []string `json:"notInterested"`
}

type PreferenceThresholds struct {
	MinimumScore      int `json:"minimumScore"`
	MaximumCandidates int `json:"maximumCandidates"`
}

func loadPreferences(path string) (PreferencesConfig, error) {
	var preferences PreferencesConfig
	if err := readJSONC(path, &preferences); err != nil {
		return PreferencesConfig{}, err
	}
	normalizePreferences(&preferences)
	if err := validatePreferences(preferences); err != nil {
		return PreferencesConfig{}, fmt.Errorf("兴趣画像配置无效: %w", err)
	}
	return preferences, nil
}

func validatePreferences(preferences PreferencesConfig) error {
	if len(preferences.PriorityEntities) == 0 {
		return fmt.Errorf("priorityEntities 不能为空")
	}
	for i, entity := range preferences.PriorityEntities {
		if strings.TrimSpace(entity.Name) == "" || len(entity.Aliases) == 0 {
			return fmt.Errorf("priorityEntities[%d] 必须填写 name 和 aliases", i)
		}
		for j, alias := range entity.Aliases {
			if alias == "" {
				return fmt.Errorf("priorityEntities[%d].aliases[%d] 不能为空", i, j)
			}
		}
	}
	requiredLists := map[string][]string{
		"signals.aiTerms":              preferences.Signals.AITerms,
		"signals.importantChanges":     preferences.Signals.ImportantChanges,
		"signals.riskEvents":           preferences.Signals.RiskEvents,
		"signals.intermediaryTerms":    preferences.Signals.IntermediaryTerms,
		"signals.intermediaryProducts": preferences.Signals.IntermediaryProducts,
		"signals.majorPolicy":          preferences.Signals.MajorPolicy,
		"signals.majorIndustryChanges": preferences.Signals.MajorIndustryChanges,
		"signals.productImpact":        preferences.Signals.ProductImpact,
		"dislikes.marketing":           preferences.Dislikes.Marketing,
		"dislikes.geopolitics":         preferences.Dislikes.Geopolitics,
		"guidance.focus":               preferences.Guidance.Focus,
		"guidance.notInterested":       preferences.Guidance.NotInterested,
	}
	for name, values := range requiredLists {
		if len(values) == 0 {
			return fmt.Errorf("%s 不能为空", name)
		}
		for i, value := range values {
			if value == "" {
				return fmt.Errorf("%s[%d] 不能为空", name, i)
			}
		}
	}
	if preferences.Thresholds.MinimumScore < 1 || preferences.Thresholds.MinimumScore > 10 {
		return fmt.Errorf("thresholds.minimumScore 必须在 1 至 10 之间")
	}
	if preferences.Thresholds.MaximumCandidates < 1 {
		return fmt.Errorf("thresholds.maximumCandidates 必须大于 0")
	}
	return nil
}

func normalizePreferences(preferences *PreferencesConfig) {
	for i := range preferences.PriorityEntities {
		preferences.PriorityEntities[i].Name = strings.TrimSpace(preferences.PriorityEntities[i].Name)
		normalizeTerms(preferences.PriorityEntities[i].Aliases)
	}
	normalizeTerms(preferences.Signals.AITerms)
	normalizeTerms(preferences.Signals.PriorityKeywords)
	normalizeTerms(preferences.Signals.ImportantChanges)
	normalizeTerms(preferences.Signals.RiskEvents)
	normalizeTerms(preferences.Signals.IntermediaryTerms)
	normalizeTerms(preferences.Signals.IntermediaryProducts)
	normalizeTerms(preferences.Signals.MajorPolicy)
	normalizeTerms(preferences.Signals.MajorIndustryChanges)
	normalizeTerms(preferences.Signals.ProductImpact)
	normalizeTerms(preferences.Dislikes.Marketing)
	normalizeTerms(preferences.Dislikes.HardExclude)
	normalizeTerms(preferences.Dislikes.Geopolitics)
	trimValues(preferences.Guidance.Focus)
	trimValues(preferences.Guidance.NotInterested)
}

func normalizeTerms(values []string) {
	for i := range values {
		values[i] = strings.ToLower(strings.TrimSpace(values[i]))
	}
}

func trimValues(values []string) {
	for i := range values {
		values[i] = strings.TrimSpace(values[i])
	}
}

func (preferences PreferencesConfig) priorityAliases() []string {
	var aliases []string
	for _, entity := range preferences.PriorityEntities {
		aliases = append(aliases, entity.Aliases...)
	}
	return aliases
}

func buildNewsRankingSystemPrompt(preferences PreferencesConfig) string {
	entityLines := make([]string, 0, len(preferences.PriorityEntities))
	for _, entity := range preferences.PriorityEntities {
		entityLines = append(entityLines, fmt.Sprintf("- %s（常见写法：%s）", entity.Name, strings.Join(entity.Aliases, "、")))
	}
	return fmt.Sprintf(`你是一个为特定用户工作的 AI 行业情报筛选器，不是泛科技新闻编辑，也不是按社会知名度评选热搜。

最高原则：先判断是否符合用户兴趣，再判断新闻在该兴趣范围内的重要性。与用户兴趣无关的新闻，即使轰动、严重或影响很多人，也必须低分并排除。

用户重点关注的实体：
%s

用户希望关注：
- %s

用户明确不关心：
- %s

确定性兴趣信号：
- 用户直接加分关键词：%s
- 重点变化：%s
- 风险事件：%s
- 国家级政策与监管：%s

明确排除词：
- 用户无条件排除：%s
- 营销推广：%s
- 无产品影响的地缘政治：%s

例外规则：
- 营销或低价渠道内容出现明确风险事件时，可以作为风险情报保留。
- 地缘政治内容只有明确影响产品、API、价格、账号或服务可用性时才可保留。
- 其他 AI 公司或模型只有在事件足以改变行业格局、开发者生态或主流产品竞争时才进入高优先级。

评分规则：
- 10 分：用户必须立即知道的核心情报，例如重点实体重大模型发布、开源、API 上线、关键额度与价格规则变化，或国家级重大 AI 监管政策。
- 8-9 分：高度相关且有明确使用价值、行业影响或风险提示。
- 7 分：相关且值得了解，但影响较有限。
- 4-6 分：仅弱相关、信息空泛、重复度高、未经证实的猜测，或只是其他普通 AI 动态。
- 1-3 分：无关新闻或推广广告。
- 当前允许返回的最低分是 %d 分。

筛选规则：
- 只返回 %d 分及以上的内容；不足上限时宁可少返回，不得为了凑数加入无关新闻。
- 暂时不要因为内容相似而省略相关标题；后续步骤会专门聚类去重。
- 只能根据标题判断，不得编造标题中没有的信息。
- reason 必须具体说明它为何符合用户兴趣，不要使用空泛评价。`,
		strings.Join(entityLines, "\n"),
		strings.Join(preferences.Guidance.Focus, "\n- "),
		strings.Join(preferences.Guidance.NotInterested, "\n- "),
		strings.Join(preferences.Signals.PriorityKeywords, "、"),
		strings.Join(preferences.Signals.ImportantChanges, "、"),
		strings.Join(preferences.Signals.RiskEvents, "、"),
		strings.Join(preferences.Signals.MajorPolicy, "、"),
		strings.Join(preferences.Dislikes.HardExclude, "、"),
		strings.Join(preferences.Dislikes.Marketing, "、"),
		strings.Join(preferences.Dislikes.Geopolitics, "、"),
		preferences.Thresholds.MinimumScore,
		preferences.Thresholds.MinimumScore,
	)
}
