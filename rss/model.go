package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sort"
	"strings"
)

// analyzeWithModel 让模型按用户兴趣画像对条目标题打分筛选，再用关键词保底规则叠加修正，返回候选列表。
func analyzeWithModel(ai AIConfig, items []Item) ([]ScoredItem, error) {
	var titles []string
	for i, item := range items {
		titles = append(titles, fmt.Sprintf("%d. [%s] %s", i+1, item.SourceName, item.Title))
	}

	prompt := fmt.Sprintf(`以下是 RSS 源中的 %d 条内容标题。

请严格按照系统消息中的用户兴趣画像进行筛选和评分，最多返回 %d 条候选，按分数从高到低排序。只返回 7 分及以上的内容，不要凑数，也不要在此阶段合并相似标题。

严格以以下 JSON 格式返回，不要返回任何其他内容：
[
  {"index": 序号, "title": "标题", "score": 分数, "reason": "一句话说明为什么重要"}
]

内容列表：
%s`, len(items), maxCandidates, strings.Join(titles, "\n"))

	content, err := requestModel(ai, []ChatMessage{
		{Role: "system", Content: newsRankingSystemPrompt},
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, err
	}

	scored, err := parseScoredItems(content)
	if err != nil {
		return nil, err
	}
	return applyKeywordWeights(scored, items), nil
}

// parseScoredItems 从模型返回内容中解析评分 JSON；标准解析失败时尝试逐行恢复有效条目。
func parseScoredItems(content string) ([]ScoredItem, error) {
	var scored []ScoredItem
	rawJSON := extractJSON(content)
	if err := json.Unmarshal([]byte(rawJSON), &scored); err != nil {
		scored = recoverScoredItems(rawJSON)
		if len(scored) == 0 {
			return nil, fmt.Errorf("解析评分 JSON 失败且未能恢复有效条目: %w\n原始内容: %s", err, content)
		}
		fmt.Printf("   警告：模型返回局部无效 JSON，已跳过坏条目并恢复 %d 条有效评分\n", len(scored))
	}
	return normalizeScoredItems(scored), nil
}

// recoverScoredItems 在 JSON 整体解析失败时，逐行尝试解析独立的 {...} 对象，尽量挽救有效评分。
func recoverScoredItems(content string) []ScoredItem {
	var recovered []ScoredItem
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimSuffix(line, ",")
		if !strings.HasPrefix(line, "{") || !strings.HasSuffix(line, "}") {
			continue
		}
		var item ScoredItem
		if json.Unmarshal([]byte(line), &item) == nil {
			recovered = append(recovered, item)
		}
	}
	return recovered
}

// normalizeScoredItems 丢弃低于入选分数的条目，按分数降序排序并截断到候选上限。
func normalizeScoredItems(scored []ScoredItem) []ScoredItem {
	scored = slices.DeleteFunc(scored, func(item ScoredItem) bool {
		return item.Score < minInterestingScore
	})
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].Score > scored[j].Score
	})
	if len(scored) > maxCandidates {
		scored = scored[:maxCandidates]
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

	resp, err := newHTTPClient(defaultRequestTimeout, false).Do(req)
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
