package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeModelServer 起一个返回固定 content 的 OpenAI 兼容 chat/completions 假端点。
// requestModel 解析 choices[0].message.content；mock 首次即返合法 JSON，不触发任何重试 Sleep。
func fakeModelServer(t *testing.T, content string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		body, _ := json.Marshal(ChatResponse{
			Choices: []ChatChoice{{Message: ChatMessage{Role: "assistant", Content: content}}},
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
}

// AI happy-path 端到端：用 httptest 假模型驱动 评分→聚类→Tabs→data.json 全链路，
// 覆盖 analyzeWithModel / groupSimilarNews / generateStoryTabs 三个阶段此前均未对 mock 跑过的
// 「请求 + 解析 + 归一化」全路径，并验证它们能正确串联产出合法 data.json。
//
// 关键约束（踩过的坑）：
//   - 两个 item 必须同 fallbackGroupIdentity 品牌（都用 GLM），否则 splitIncompatibleGroups
//     会把它们拆成两个 group，与 mock 的单 group_index 不匹配。
//   - mock 始终返合法 JSON → 不触发 grouping/tabs 的退避 time.Sleep；vision 因 items 无远程图而不触发。
//
// 名为 integration 而非 e2e：它手动构造 items 再逐个调用 analyzeWithModel/groupSimilarNews/
// generateStoryTabs/generateDataJSON，用 mock 挡住 AI 边界；不覆盖 run()/loadConfig/RSS/state。
func TestPipelineIntegrationWithMockedAIStagesProducesValidDataJSON(t *testing.T) {
	preferences := testPreferences(t)
	preferences.Thresholds.MinimumScore = 7
	preferences.Thresholds.MaximumCandidates = 10
	preferences.Signals.PriorityKeywords = []string{"智谱", "GLM"}

	now := time.Date(2026, 6, 28, 9, 0, 0, 0, time.UTC)
	items := []Item{
		{ID: "1", SourceID: "linuxdo", SourceName: "LinuxDo", Title: "智谱发布GLM-5.2并开源", Link: "https://example.com/1", PublishedAt: now, Description: "智谱发布新模型并开源。"},
		{ID: "2", SourceID: "linuxdo", SourceName: "LinuxDo", Title: "智谱GLM系列模型推理成本下调", Link: "https://example.com/2", PublishedAt: now.Add(time.Hour), Description: "智谱下调推理成本。"},
	}

	scoredServer := fakeModelServer(t, `[{"index":1,"title":"智谱发布GLM-5.2并开源","score":9,"reason":"重要模型更新"},{"index":2,"title":"智谱GLM系列模型推理成本下调","score":8,"reason":"成本变化"}]`)
	defer scoredServer.Close()
	groupsServer := fakeModelServer(t, `[{"title":"智谱 GLM-5.2 发布与成本调整","navigation_title":"GLM","score":9,"reason":"重要模型更新","source_indexes":[1,2],"highlights":[{"index":1,"point":"GLM-5.2 发布"},{"index":2,"point":"推理成本下调"}]}]`)
	defer groupsServer.Close()
	tabsServer := fakeModelServer(t, `[{"group_index":1,"tabs":[
		{"title":"模型发布","summary":"本次更新带来全新模型架构，性能较前代有大幅提升。","subtitle":"智谱正式发布全新一代 GLM-5.2 模型并同步开源，显著降低推理成本。","kind":"fact","evidence_indexes":[1]},
		{"title":"用户影响","summary":"新模型让开发者在调用接口时获得更好的性价比与体验。","subtitle":"智谱 GLM 系列模型推理成本下调，开发者调用接口的费用明显下降。","kind":"impact","evidence_indexes":[2]}
	]}]`)
	defer tabsServer.Close()

	mockedAI := func(s *httptest.Server) AIConfig {
		return AIConfig{APIKey: "test-key", BaseURL: s.URL, Model: "test-model"}
	}

	scored, err := analyzeWithModel(mockedAI(scoredServer), preferences, items)
	if err != nil {
		t.Fatalf("analyzeWithModel failed: %v", err)
	}
	if len(scored) == 0 {
		t.Fatal("analyzeWithModel returned no scored items")
	}

	groups, err := groupSimilarNews(mockedAI(groupsServer), scored, items)
	if err != nil {
		t.Fatalf("groupSimilarNews failed: %v", err)
	}
	if len(groups) == 0 {
		t.Fatal("groupSimilarNews returned no groups")
	}

	groups, err = generateStoryTabs(mockedAI(tabsServer), groups, items)
	if err != nil {
		t.Fatalf("generateStoryTabs failed: %v", err)
	}

	// generateDataJSON 默认 vision=true → 跳过候选图下载（避免触网）
	reportPath := filepath.Join(t.TempDir(), "data.json")
	if err := generateDataJSON(reportPath, groups, items); err != nil {
		t.Fatalf("generateDataJSON failed: %v", err)
	}

	data, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	var report DataJSON
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatalf("produced data.json is not valid JSON: %v", err)
	}
	if len(report.Stories) == 0 {
		t.Fatal("pipeline produced no stories")
	}
	for i, story := range report.Stories {
		if len(story.Tabs) < minStoryTabs {
			t.Fatalf("story[%d] has %d tabs, need ≥%d", i, len(story.Tabs), minStoryTabs)
		}
	}

	// happy-path 证明：data.json 含 mock Tabs 的独有摘要短语；兜底 Tab 只用 Title/Reason，不会产生它。
	if !strings.Contains(string(data), "全新模型架构") {
		t.Fatalf("expected mock-generated tab content in data.json; fallback may have masked the AI path:\n%s", data)
	}
}
