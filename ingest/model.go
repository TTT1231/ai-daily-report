package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// analyzeWithModel 让模型按用户兴趣画像对条目标题打分筛选，再用关键词保底规则叠加修正，返回候选列表。
func analyzeWithModel(ai AIConfig, preferences PreferencesConfig, items []Item) ([]ScoredItem, error) {
	var titles []string
	for i, item := range items {
		titles = append(titles, fmt.Sprintf("%d. [%s] %s", i+1, item.SourceName, item.Title))
	}

	prompt := fmt.Sprintf(`以下是 RSS 源中的 %d 条内容标题。

请严格按照系统消息中的用户兴趣画像进行筛选和评分，最多返回 %d 条候选，按分数从高到低排序。只返回 %d 分及以上的内容，不要凑数，也不要在此阶段合并相似标题。

严格以以下 JSON 格式返回，不要返回任何其他内容：
[
  {"index": 序号, "title": "标题", "score": 分数, "reason": "一句话说明为什么重要"}
]

内容列表：
%s`, len(items), preferences.Thresholds.MaximumCandidates, preferences.Thresholds.MinimumScore, strings.Join(titles, "\n"))

	content, err := requestModel(ai, []ChatMessage{
		{Role: "system", Content: buildNewsRankingSystemPrompt(preferences)},
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, err
	}

	scored, err := parseScoredItems(content)
	if err != nil {
		return nil, err
	}
	scored = normalizeScoredItems(preferences, scored)
	return applyKeywordWeights(preferences, scored, items), nil
}

// parseScoredItems 从模型返回内容中解析评分 JSON；标准解析失败时先尝试修复常见的
// 「字符串值漏掉左引号」再整体解析，最后退化为逐行恢复有效条目。
func parseScoredItems(content string) ([]ScoredItem, error) {
	var scored []ScoredItem
	rawJSON := extractJSON(content)
	if err := json.Unmarshal([]byte(rawJSON), &scored); err != nil {
		if repaired := repairUnquotedStrings(rawJSON); repaired != rawJSON {
			if err2 := json.Unmarshal([]byte(repaired), &scored); err2 == nil {
				fmt.Printf("   ⚠️  警告：模型返回的 JSON 存在未加引号的字符串值，已自动修复并解析\n")
				return scored, nil
			}
		}
		scored = recoverScoredItems(rawJSON)
		if len(scored) == 0 {
			return nil, fmt.Errorf("解析评分 JSON 失败且未能恢复有效条目: %w\n原始内容: %s", err, content)
		}
		fmt.Printf("   ⚠️  警告：模型返回局部无效 JSON，已跳过坏条目并恢复 %d 条有效评分\n", len(scored))
	}
	return scored, nil
}

// unquotedStringRe 匹配形如 "key": value" 的字符串值：value 缺失左引号、却保留了
// 右引号（模型偶发产物）。已正确加引号的值以 " 开头，不会被本规则命中。
var unquotedStringRe = regexp.MustCompile(`("[^"]+"):\s*([^\d\-[{"][^"]*?)"(\s*[},])`)

// repairUnquotedStrings 给漏掉左引号的字符串值补回引号，幂等：对已修复或本就合法的
// 内容不再改动。
func repairUnquotedStrings(s string) string {
	return unquotedStringRe.ReplaceAllString(s, "$1: \"$2\"$3")
}

// recoverScoredItems 在 JSON 整体解析失败时，按括号深度扫描出每个平衡的 {...} 对象
// 再逐个解析，尽量挽救有效评分。相比按行匹配，它能处理模型美化输出（每个对象跨多行）
// 或压缩成一行的情况；字符串字面量内的 { } 与 " 不会干扰对象边界判定。
func recoverScoredItems(content string) []ScoredItem {
	var recovered []ScoredItem
	depth := 0
	start := -1
	inString := false
	escaped := false
	for i, r := range content {
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if r == '\\' {
				escaped = true
				continue
			}
			if r == '"' {
				inString = false
			}
			continue
		}
		switch r {
		case '"':
			inString = true
		case '{':
			if depth == 0 {
				start = i
			}
			depth++
		case '}':
			depth--
			if depth == 0 && start >= 0 {
				if item, ok := recoverScoredObject(content[start : i+1]); ok {
					recovered = append(recovered, item)
				}
				start = -1
			} else if depth < 0 {
				// 多余的 }：JSON 结构已破坏，重置以避免后续误配对。
				depth = 0
				start = -1
			}
		}
	}
	return recovered
}

// recoverScoredObject 尝试把单个 {...} 文本解析成评分条目；标准解析失败时再尝试修复漏引号。
func recoverScoredObject(objectText string) (ScoredItem, bool) {
	var item ScoredItem
	if json.Unmarshal([]byte(objectText), &item) == nil {
		return item, true
	}
	if repaired := repairUnquotedStrings(objectText); repaired != objectText {
		if json.Unmarshal([]byte(repaired), &item) == nil {
			return item, true
		}
	}
	return ScoredItem{}, false
}

// normalizeScoredItems 丢弃低于入选分数的条目，按分数降序排序并截断到候选上限。
func normalizeScoredItems(preferences PreferencesConfig, scored []ScoredItem) []ScoredItem {
	scored = slices.DeleteFunc(scored, func(item ScoredItem) bool {
		return item.Score < preferences.Thresholds.MinimumScore
	})
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].Score > scored[j].Score
	})
	if len(scored) > preferences.Thresholds.MaximumCandidates {
		scored = scored[:preferences.Thresholds.MaximumCandidates]
	}
	return scored
}

// requestModel 向 OpenAI 兼容的 chat/completions 接口发送非流式请求，返回首条回复的文本内容。
func requestModel(ai AIConfig, messages []ChatMessage) (string, error) {
	requestBody := map[string]any{
		"model":    ai.Model,
		"messages": messages,
		"stream":   false,
	}
	for key, value := range ai.ExtraBody {
		if key != "model" && key != "messages" && key != "stream" {
			requestBody[key] = value
		}
	}

	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("构建模型请求失败: %w", err)
	}
	req, err := http.NewRequest("POST", ai.BaseURL+"/chat/completions", bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("创建模型请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ai.APIKey)

	resp, err := newHTTPClient(defaultRequestTimeout, false, false).Do(req)
	if err != nil {
		return "", fmt.Errorf("请求模型 API 失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取模型响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("模型 API 返回 %d: %s", resp.StatusCode, truncateRunes(string(body), 500))
	}

	var response ChatResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("解析模型 API 响应失败: %w", err)
	}
	if len(response.Choices) == 0 {
		return "", fmt.Errorf("模型 API 返回空 choices")
	}
	return response.Choices[0].Message.Content, nil
}

// extractJSON 从模型文本中提取 JSON 片段：优先取 ```json 代码块，其次普通代码块，最后回退到首尾方括号之间。
func extractJSON(content string) string {
	if idx := strings.Index(content, "```json"); idx != -1 {
		start := idx + 7
		if end := strings.Index(content[start:], "```"); end != -1 {
			return strings.TrimSpace(content[start : start+end])
		}
	}
	if idx := strings.Index(content, "```"); idx != -1 {
		start := idx + 3
		if end := strings.Index(content[start:], "```"); end != -1 {
			return strings.TrimSpace(content[start : start+end])
		}
	}
	start := strings.Index(content, "[")
	end := strings.LastIndex(content, "]")
	if start != -1 && end != -1 && end > start {
		return content[start : end+1]
	}
	return content
}
