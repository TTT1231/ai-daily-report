package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// AI 失败处理覆盖说明（诚实标注范围）：
//
// 本用例只覆盖「评分阶段（analyzeWithModel）的叶子请求在服务端 5xx 时返回 err」——即 requestModel
// 单次请求失败、无重试 Sleep、快失败这一条最小路径。
//
// 未覆盖（不要把本文件当成 run() 失败接线的完整证明）：
//   - run() 把 err 接成「exit 1 + 不产出 data.json」的顶层接线：run() 没有依赖注入缝，
//     其内部串联 loadConfig/RSS/state/三个 AI 阶段，无法在不触网/不读真实配置的前提下单独驱动，
//     故此处不验；要覆盖需先给 run() 加可注入的边界。
//   - 聚类（groupSimilarNews）/Tabs（generateStoryTabs）阶段的失败触发：它们与评分阶段共用
//     requestModel 的 err 机制，但外层各自带退避重试 Sleep（grouping / story_tabs），全失败用例
//     即便替换 rssRetrySleep 也偏慢，且 requestModel 的 err 行为已由此处叶子用例锁定，故不重复。
func TestAnalyzeWithModelFailsFastOnServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	ai := AIConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test-model"}
	_, err := analyzeWithModel(ai, testPreferences(t), []Item{{ID: "x", Title: "某条新闻标题"}})
	if err == nil {
		t.Fatal("expected analyzeWithModel to return an error when the model endpoint returns 500")
	}
}
