package main

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestAnalyzeRemoteImageWithClaudeParsesAndCleansStructuredOutput 覆盖正常路径：
// 假 execClaudeVision 返回带 structured_output 的 claude CLI 风格信封，其中 facts
// 带前后空白与重复项、uncertain 带噪声、summary 带两端空白，验证 cleanVisionFacts
// （去空白 + 去重）与 TrimSpace 在 analyzeRemoteImageWithClaude 内被正确串联。
//
// 这条路径原先因 exec.LookPath + exec.CommandContext 强依赖本机 claude CLI 而无法测试；
// 抽出 execClaudeVision 可替换变量后可在不 spawn 进程、不碰 PATH、跨平台的前提下覆盖。
func TestAnalyzeRemoteImageWithClaudeParsesAndCleansStructuredOutput(t *testing.T) {
	// claude CLI 实际输出形如 {"type":"result","structured_output":{...}}，这里故意在
	// facts/summary 里塞空白与重复以驱动 cleanVisionFacts + TrimSpace。
	fakeOutput := []byte(`{` +
		`"type":"result",` +
		`"structured_output":{` +
		`"relevant":true,` +
		`"facts":["  fact1  ","fact1","fact2"],` +
		`"uncertain":["?u"],` +
		`"summary":"  sum  "` +
		`}}`)

	old := execClaudeVision
	defer func() { execClaudeVision = old }()
	execClaudeVision = func(args []string, timeout time.Duration) ([]byte, error) {
		return fakeOutput, nil
	}

	result, err := analyzeRemoteImageWithClaude(
		"http://example.com/i.png",
		"ctx",
		&VisionAnalyzer{timeout: time.Second, maxBudgetUSD: "1.00"},
	)
	if err != nil {
		t.Fatalf("analyzeRemoteImageWithClaude() unexpected err: %v", err)
	}
	if !result.Relevant {
		t.Errorf("Relevant = false, want true")
	}
	wantFacts := []string{"fact1", "fact2"}
	if !reflect.DeepEqual(result.Facts, wantFacts) {
		t.Errorf("Facts = %#v, want %#v (expected trim + dedup)", result.Facts, wantFacts)
	}
	if result.Summary != "sum" {
		t.Errorf("Summary = %q, want %q (expected trimmed)", result.Summary, "sum")
	}
}

// TestAnalyzeRemoteImageWithClaudePropagatesCLINotFound 覆盖 claude CLI 未安装：
// 假 execClaudeVision 返回「未找到 claude CLI」错误，验证它被原样透传（语义与
// 重构前 LookPath 失败一致），不会被错误地包进「Claude CLI 返回失败」。
func TestAnalyzeRemoteImageWithClaudePropagatesCLINotFound(t *testing.T) {
	old := execClaudeVision
	defer func() { execClaudeVision = old }()
	execClaudeVision = func(args []string, timeout time.Duration) ([]byte, error) {
		return nil, fmt.Errorf("未找到 claude CLI")
	}

	_, err := analyzeRemoteImageWithClaude(
		"http://example.com/i.png",
		"ctx",
		&VisionAnalyzer{timeout: time.Second, maxBudgetUSD: "1.00"},
	)
	if err == nil {
		t.Fatal("analyzeRemoteImageWithClaude() err = nil, want error about missing claude CLI")
	}
	if !strings.Contains(err.Error(), "未找到") {
		t.Errorf("err = %q, want it to contain %q", err.Error(), "未找到")
	}
}
