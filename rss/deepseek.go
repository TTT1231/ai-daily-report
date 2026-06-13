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
	"time"
)

func analyzeWithDeepSeek(apiKey string, items []Item) ([]ScoredItem, error) {
	var titles []string
	for i, item := range items {
		titles = append(titles, fmt.Sprintf("%d. %s", i+1, item.Title))
	}

	prompt := fmt.Sprintf(`以下是来自科技社区“前沿快讯”板块的 %d 条帖子标题。

请严格按照系统消息中的用户兴趣画像进行筛选和评分，最多返回 %d 条候选，按分数从高到低排序。只返回 7 分及以上的内容，不要凑数，也不要在此阶段合并相似标题。

严格以以下 JSON 格式返回，不要返回任何其他内容：
[
  {"index": 序号, "title": "标题", "score": 分数, "reason": "一句话说明为什么重要"}
]

帖子列表：
%s`, len(items), maxCandidates, strings.Join(titles, "\n"))

	content, err := requestDeepSeek(apiKey, []DSMessage{
		{Role: "system", Content: newsRankingSystemPrompt},
		{Role: "user", Content: prompt},
	}, DSRequestOptions{Thinking: "disabled"})
	if err != nil {
		return nil, err
	}

	scored, err := parseScoredItems(content)
	if err != nil {
		return nil, err
	}
	return applyKeywordWeights(scored, items), nil
}

func parseScoredItems(content string) ([]ScoredItem, error) {
	var scored []ScoredItem
	rawJSON := extractJSON(content)
	if err := json.Unmarshal([]byte(rawJSON), &scored); err != nil {
		scored = recoverScoredItems(rawJSON)
		if len(scored) == 0 {
			return nil, fmt.Errorf("解析评分 JSON 失败且未能恢复有效条目: %w\n原始内容: %s", err, content)
		}
		fmt.Printf("⚠ DeepSeek 返回了局部无效 JSON，已跳过坏条目并恢复 %d 条有效评分\n", len(scored))
	}
	return normalizeScoredItems(scored), nil
}

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

func requestDeepSeek(apiKey string, messages []DSMessage, options DSRequestOptions) (string, error) {
	reqBody := DSRequest{Model: dsModel, Messages: messages, Stream: false}
	if options.Thinking != "" {
		reqBody.Thinking = &DSThinking{Type: options.Thinking}
	}
	reqBody.ReasoningEffort = options.ReasoningEffort

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("构建请求失败: %w", err)
	}
	req, err := http.NewRequest("POST", dsBaseURL+"/chat/completions", bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 DeepSeek API 失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("DeepSeek API 返回 %d: %s", resp.StatusCode, string(body))
	}

	var dsResp DSResponse
	if err := json.Unmarshal(body, &dsResp); err != nil {
		return "", fmt.Errorf("解析 API 响应失败: %w", err)
	}
	if len(dsResp.Choices) == 0 {
		return "", fmt.Errorf("DeepSeek 返回空响应")
	}
	return dsResp.Choices[0].Message.Content, nil
}

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
