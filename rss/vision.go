package main

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	imageAttributePattern = regexp.MustCompile(`(?i)(?:href|src|data-download-href)=["']([^"']+)["']`)
	imageURLPattern       = regexp.MustCompile(`(?i)^https?://.+\.(?:avif|gif|jpe?g|png|webp)(?:\?.*)?$`)
)

const visionJSONSchema = `{"type":"object","properties":{"relevant":{"type":"boolean"},"facts":{"type":"array","items":{"type":"string"}},"uncertain":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"}},"required":["relevant","facts","uncertain","summary"],"additionalProperties":false}`

type VisionResult struct {
	Relevant  bool     `json:"relevant"`
	Facts     []string `json:"facts"`
	Uncertain []string `json:"uncertain"`
	Summary   string   `json:"summary"`
}

type VisionAnalyzer struct {
	enabled       bool
	maxCalls      int
	maxImages     int
	textThreshold int
	timeout       time.Duration
	maxBudgetUSD  string
	calls         int
}

func newVisionAnalyzer() *VisionAnalyzer {
	return &VisionAnalyzer{
		enabled:       readBoolEnv("CLAUDE_VISION_ENABLED", true),
		maxCalls:      readPositiveIntEnv("CLAUDE_VISION_MAX_CALLS", 4),
		maxImages:     readPositiveIntEnv("CLAUDE_VISION_MAX_IMAGES_PER_SOURCE", 2),
		textThreshold: readPositiveIntEnv("CLAUDE_VISION_TEXT_THRESHOLD", 500),
		timeout:       time.Duration(readPositiveIntEnv("CLAUDE_VISION_TIMEOUT_SECONDS", 180)) * time.Second,
		maxBudgetUSD:  readPositiveFloatEnv("CLAUDE_VISION_MAX_BUDGET_USD", "1.00"),
	}
}

func (analyzer *VisionAnalyzer) analyzeItem(item Item, group NewsGroup) []VisionResult {
	if !analyzer.shouldAnalyze(item, group) {
		return nil
	}

	var results []VisionResult
	for _, imageURL := range extractRemoteImageURLs(item.Description) {
		if analyzer.calls >= analyzer.maxCalls || len(results) >= analyzer.maxImages {
			break
		}
		analyzer.calls++
		fmt.Printf("   👁 Claude 视觉补充：%s\n", imageURL)
		result, err := analyzeRemoteImageWithClaude(imageURL, item.Title, analyzer)
		if err != nil {
			fmt.Printf("   ⚠ Claude 视觉识别失败，继续使用文本材料: %v\n", err)
			continue
		}
		if result.Relevant && len(result.Facts) > 0 {
			results = append(results, result)
		}
	}
	return results
}

func (analyzer *VisionAnalyzer) shouldAnalyze(item Item, group NewsGroup) bool {
	return analyzer.enabled &&
		group.Score >= 9 &&
		analyzer.calls < analyzer.maxCalls &&
		len([]rune(itemSourceText(item))) < analyzer.textThreshold &&
		len(extractRemoteImageURLs(item.Description)) > 0
}

func analyzeRemoteImageWithClaude(imageURL, sourceTitle string, analyzer *VisionAnalyzer) (VisionResult, error) {
	if _, err := exec.LookPath("claude"); err != nil {
		return VisionResult{}, fmt.Errorf("未找到 claude CLI")
	}

	prompt := fmt.Sprintf(`调用可用的远程图像分析 MCP，直接分析图片 URL，不要下载到本地。

来源标题：%s
图片 URL：%s

任务：
1. 判断图片是否与来源标题的底层事件直接相关。
2. 只提取图片中明确可见的文字和可直接确认的事实。
3. 不得推测真实性、背景、模型定位或图片未显示的信息。
4. 如果图片与来源标题无关，relevant=false 且 facts=[]。
5. 按指定结构化输出格式返回结果。`, sourceTitle, imageURL)

	ctx, cancel := context.WithTimeout(context.Background(), analyzer.timeout)
	defer cancel()
	command := exec.CommandContext(ctx,
		"claude",
		"--dangerously-skip-permissions",
		"-p",
		"--no-session-persistence",
		"--output-format", "json",
		"--json-schema", visionJSONSchema,
		"--max-budget-usd", analyzer.maxBudgetUSD,
		prompt,
	)
	output, err := command.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return VisionResult{}, fmt.Errorf("Claude 视觉识别超时")
	}
	if err != nil {
		return VisionResult{}, fmt.Errorf("Claude CLI 返回失败: %w: %s", err, truncateRunes(string(output), 300))
	}

	var result VisionResult
	if err := parseClaudeVisionOutput(output, &result); err != nil {
		return VisionResult{}, fmt.Errorf("解析 Claude 视觉 JSON 失败: %w: %s", err, truncateRunes(string(output), 300))
	}
	result.Facts = cleanVisionFacts(result.Facts)
	result.Uncertain = cleanVisionFacts(result.Uncertain)
	result.Summary = strings.TrimSpace(result.Summary)
	return result, nil
}

func parseClaudeVisionOutput(output []byte, result *VisionResult) error {
	var envelope struct {
		StructuredOutput json.RawMessage `json:"structured_output"`
		Result           string          `json:"result"`
	}
	if err := json.Unmarshal(output, &envelope); err == nil {
		if len(envelope.StructuredOutput) > 0 && string(envelope.StructuredOutput) != "null" {
			return json.Unmarshal(envelope.StructuredOutput, result)
		}
		if envelope.Result != "" {
			return json.Unmarshal([]byte(extractJSONObject(envelope.Result)), result)
		}
	}
	return json.Unmarshal([]byte(extractJSONObject(string(output))), result)
}

func extractRemoteImageURLs(description string) []string {
	seen := make(map[string]bool)
	var originals []string
	var others []string
	for _, match := range imageAttributePattern.FindAllStringSubmatch(description, -1) {
		imageURL := html.UnescapeString(strings.TrimSpace(match[1]))
		if !imageURLPattern.MatchString(imageURL) || seen[imageURL] {
			continue
		}
		seen[imageURL] = true
		if strings.Contains(imageURL, "/original/") {
			originals = append(originals, imageURL)
		} else {
			others = append(others, imageURL)
		}
	}
	if len(originals) > 0 {
		return originals
	}
	return others
}

func extractJSONObject(content string) string {
	content = strings.TrimSpace(content)
	if start := strings.Index(content, "{"); start != -1 {
		if end := strings.LastIndex(content, "}"); end > start {
			return content[start : end+1]
		}
	}
	return content
}

func cleanVisionFacts(facts []string) []string {
	seen := make(map[string]bool)
	var cleaned []string
	for _, fact := range facts {
		fact = strings.TrimSpace(fact)
		if fact == "" || seen[fact] {
			continue
		}
		seen[fact] = true
		cleaned = append(cleaned, fact)
	}
	return cleaned
}

func readBoolEnv(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	return err == nil && parsed
}

func readPositiveIntEnv(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func readPositiveFloatEnv(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return value
}
