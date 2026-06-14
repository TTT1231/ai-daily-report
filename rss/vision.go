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

// newVisionAnalyzer 读取一系列 CLAUDE_VISION_* 环境变量，构造带开关、调用上限与预算的图片视觉分析器。
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

// analyzeItem 在满足条件时对条目中的远程图片逐张调用 Claude 视觉识别，返回与来源相关的事实结果。
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
		fmt.Printf("   视觉补充：%s\n", imageURL)
		result, err := analyzeRemoteImageWithClaude(imageURL, item.Title, analyzer)
		if err != nil {
			fmt.Printf("   警告：Claude 视觉识别失败，继续使用文本材料：%v\n", err)
			continue
		}
		if result.Relevant && len(result.Facts) > 0 {
			results = append(results, result)
		}
	}
	return results
}

// shouldAnalyze 判断是否应对该条目做图片视觉识别：
// 仅在启用、Story 高分、未超调用上限、正文较短且含远程图片时才触发，以控制成本。
func (analyzer *VisionAnalyzer) shouldAnalyze(item Item, group NewsGroup) bool {
	return analyzer.enabled &&
		group.Score >= 9 &&
		analyzer.calls < analyzer.maxCalls &&
		len([]rune(cleanRSS2ItemText(item))) < analyzer.textThreshold &&
		len(extractRemoteImageURLs(item.Description)) > 0
}

// analyzeRemoteImageWithClaude 通过本机 claude CLI 调用图像分析 MCP 直接识别远程图片，
// 在预算与超时约束下返回结构化的事实/不确定项结果。
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
		"--effort", "low",
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

// parseClaudeVisionOutput 从 claude CLI 的输出中解析视觉结果：优先 structured_output，其次 result 文本，最后整体兜底。
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

// extractRemoteImageURLs 从正文中提取远程图片地址：优先 /original/ 原图，否则用其它图片，按出现去重。
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

// extractJSONObject 从文本中截取首个 { 到最后一个 } 之间的 JSON 对象文本。
func extractJSONObject(content string) string {
	content = strings.TrimSpace(content)
	if start := strings.Index(content, "{"); start != -1 {
		if end := strings.LastIndex(content, "}"); end > start {
			return content[start : end+1]
		}
	}
	return content
}

// cleanVisionFacts 去除视觉识别事实中的空白与重复项。
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

// readBoolEnv 读取布尔型环境变量，缺失或解析失败时返回 fallback。
func readBoolEnv(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	return err == nil && parsed
}

// readPositiveIntEnv 读取正整数环境变量，缺失或非正时返回 fallback。
func readPositiveIntEnv(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

// readPositiveFloatEnv 校验环境变量是否为正数：合法时原样返回该字符串，否则返回 fallback。
func readPositiveFloatEnv(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return value
}
