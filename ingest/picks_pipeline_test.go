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

// TestPicksPathEndToEnd 覆盖 runPicks 的核心链路（人工 pick 路径）：
// 写 rss-state.json + picks.json → 重构 items → hash 匹配 → 合成单来源 Story →
// generateStoryTabs(pickedGroupIndexes 全标记) → generateDataJSON。
//
// 验证五个关键点：
//  1. 命门：picks.json 的 hash 能在 rss-state.json 重构后重新算出且完全相等（CanonicalID 完整还原）。
//  2. 每条 picked 独立成一个单来源 Story（不合并、不聚类），SourceIndexes 长度恒为 1。
//  3. 未 pick 的条目不进 Story；picks 里不在候选池的 hash 静默跳过（stale pick 不报错）。
//  4. 坑A：picked Story 有效 Tab 不足 minStoryTabs 时走 backfillStoryTabs 降级补齐，不剔除、不报错。
//  5. backfill 出来的 Tab 内容有效（title/summary/subtitle 非空），能过 generateDataJSON 的 minStoryTabs 闸。
func TestPicksPathEndToEnd(t *testing.T) {
	now := time.Date(2026, 7, 9, 10, 0, 0, 0, time.UTC)
	items := []Item{
		{
			ID: "guid-1", StableID: "topic-111", CanonicalID: "linuxdo:topic:111",
			SourceID: "linuxdo-news", SourceName: "LinuxDo",
			Title: "DeepSeek 自研芯片减少对英伟达依赖", Link: "https://linux.do/t/topic/111",
			PubDate: "Wed, 09 Jul 26 10:00:00 +0800", PublishedAt: now,
			Description: "<p>DeepSeek 正在自研 AI 芯片，以减少对英伟达和华为的依赖。</p>",
		},
		{
			ID: "guid-2", StableID: "topic-222", CanonicalID: "linuxdo:topic:222",
			SourceID: "linuxdo-news", SourceName: "LinuxDo",
			Title: "美光财报发布营收超预期", Link: "https://linux.do/t/topic/222",
			PubDate: "Wed, 09 Jul 26 09:00:00 +0800", PublishedAt: now.Add(-time.Hour),
			Description: "<p>美光发布最新季度财报，营收超出市场预期。</p>",
		},
		{
			ID: "guid-3", StableID: "topic-333", CanonicalID: "linuxdo:topic:333",
			SourceID: "linuxdo-news", SourceName: "LinuxDo",
			Title: "未 pick 的条目不该进视频", Link: "https://linux.do/t/topic/333",
			PubDate: "Wed, 09 Jul 26 08:00:00 +0800", PublishedAt: now.Add(-2 * time.Hour),
			Description: "<p>这条没有被用户 pick。</p>",
		},
	}

	dir := t.TempDir()
	statePath := filepath.Join(dir, "rss-state.json")
	picksPath := filepath.Join(dir, "picks.json")

	// 写 rss-state.json（10 字段完整）
	if err := saveRSSState(statePath, snapshotRSSState(items)); err != nil {
		t.Fatalf("saveRSSState error = %v", err)
	}

	// 关键点 1（命门）：picks 的 hash 必须从 itemFingerprint 算出来（和 rss-state.json 的 key 同源）。
	// 另外加一条不在候选池的 stale hash，验证静默跳过。
	hash1 := itemFingerprint(items[0])
	hash2 := itemFingerprint(items[1])
	staleHash := "0000000000000000000000000000000000000000000000000000000000000000"
	picks := Picks{hash1: true, hash2: true, staleHash: true}
	if err := savePicks(picksPath, picks); err != nil {
		t.Fatalf("savePicks error = %v", err)
	}

	// ---- 模拟 runPicks 的核心逻辑 ----
	loaded, err := loadRSSStateAsItems(statePath)
	if err != nil {
		t.Fatalf("loadRSSStateAsItems error = %v", err)
	}

	// 关键点 1 显式断言：重构后重新算的 hash 必须和写入时的 hash 完全相等。
	loadedHashes := make(map[string]bool, len(loaded))
	for _, item := range loaded {
		h := itemFingerprint(item)
		loadedHashes[h] = true
	}
	if !loadedHashes[hash1] {
		t.Fatalf("命门失败：重构后算出的 items 里找不到原 hash1 %q（CanonicalID 还原不完整）", hash1)
	}
	if !loadedHashes[hash2] {
		t.Fatalf("命门失败：重构后算出的 items 里找不到原 hash2 %q（CanonicalID 还原不完整）", hash2)
	}

	loadedPicks, err := loadPicks(picksPath)
	if err != nil {
		t.Fatalf("loadPicks error = %v", err)
	}

	// hash 匹配 + stale pick 跳过
	hashToIndex := make(map[string]int, len(loaded))
	for i, item := range loaded {
		hashToIndex[itemFingerprint(item)] = i + 1
	}
	pickedIndexes := make(map[int]bool)
	var unmatchedCount int
	for hash := range loadedPicks {
		idx, ok := hashToIndex[hash]
		if !ok {
			unmatchedCount++
			continue // stale pick 静默跳过（关键点 3）
		}
		pickedIndexes[idx] = true
	}
	if unmatchedCount != 1 {
		t.Fatalf("期望 1 条 stale pick 被跳过，实际 %d", unmatchedCount)
	}
	if len(pickedIndexes) != 2 {
		t.Fatalf("期望匹配 2 条 pick，实际 %d", len(pickedIndexes))
	}

	// 合成单来源 Story（与 main.go runPicks 一致）
	groups := make([]NewsGroup, 0, len(pickedIndexes))
	for i, item := range loaded {
		idx := i + 1
		if !pickedIndexes[idx] {
			continue
		}
		groups = append(groups, NewsGroup{
			Title:           item.Title,
			NavigationTitle: cleanDisplayTitle(item.Title),
			Score:           10,
			Reason:          "人工 pick",
			SourceIndexes:   []int{idx},
			Highlights:      []NewsHighlight{{Index: idx, Point: item.Title}},
		})
	}

	// 关键点 2：每条 picked 独立成单来源 Story
	if len(groups) != 2 {
		t.Fatalf("期望 2 个 Story，实际 %d", len(groups))
	}
	for i, g := range groups {
		if len(g.SourceIndexes) != 1 {
			t.Fatalf("Story[%d] %q 有 %d 个来源（应恒为 1：每条 picked 独立成 Story）",
				i, g.Title, len(g.SourceIndexes))
		}
	}
	// 关键点 3：未 pick 的条目不进 Story
	for _, g := range groups {
		if strings.Contains(g.Title, "未 pick") {
			t.Fatal("未 pick 的条目不应进 Story")
		}
	}

	// 所有 group 标记为 picked
	pickedGroupIndexes := make(map[int]bool, len(groups))
	for i := range groups {
		pickedGroupIndexes[i] = true
	}

	// mock AI：第一个 Story 给足 2 个合格 Tab（不触发 backfill），第二个 Story 只给 1 个合格 Tab（触发 backfill 补到 2）。
	// summary 必须 ≥ minTabSummaryRunes(25) 汉字才能过 normalizeStoryTabs 校验。
	tabsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		resp := `[{"group_index":1,"tabs":[
			{"title":"自研芯片","summary":"DeepSeek 正在自主研发专用芯片以降低对英伟达 GPU 的依赖，这是重要的供应链自主化举措。","subtitle":"DeepSeek 正在自研 AI 芯片以减少对英伟达和华为的芯片依赖。","kind":"fact","evidence_indexes":[1]},
			{"title":"行业影响","summary":"自研芯片若成功将显著降低推理成本，改变当前算力市场格局，影响整个产业链上下游。","subtitle":"DeepSeek 自研芯片有望降低推理成本并改变算力市场格局。","kind":"impact","evidence_indexes":[1]}
		]},{"group_index":2,"tabs":[
			{"title":"营收超预期","summary":"美光最新季度营收超出华尔街分析师一致预期，存储芯片需求强劲推动业绩增长。","subtitle":"美光发布最新季度财报营收超出市场预期，存储芯片需求强劲。","kind":"fact","evidence_indexes":[2]}
		]}]`
		body, _ := json.Marshal(ChatResponse{
			Choices: []ChatChoice{{Message: ChatMessage{Role: "assistant", Content: resp}}},
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	defer tabsServer.Close()

	ai := AIConfig{APIKey: "test-key", BaseURL: tabsServer.URL, Model: "test-model"}
	groups, err = generateStoryTabs(ai, groups, loaded, pickedGroupIndexes)
	if err != nil {
		t.Fatalf("generateStoryTabs failed: %v", err)
	}

	// 关键点 4（坑A）：第二个 Story 原本只有 1 个有效 Tab，picked 路径应降级补齐到 ≥2，不剔除。
	if len(groups) != 2 {
		t.Fatalf("picked 路径不应剔除 Story：期望 2 个，实际 %d", len(groups))
	}
	// 第二个 Story（美光）应被 backfill 补齐——验证它现在有 ≥2 个 Tab
	var meiguang *NewsGroup
	for i := range groups {
		if strings.Contains(groups[i].Title, "美光") {
			meiguang = &groups[i]
		}
	}
	if meiguang == nil {
		t.Fatal("找不到美光 Story")
	}
	if len(meiguang.Tabs) < minStoryTabs {
		t.Fatalf("坑A失败：美光 Story 原本 1 个有效 Tab，应 backfill 到 ≥%d，实际 %d",
			minStoryTabs, len(meiguang.Tabs))
	}

	// 关键点 5：backfill 出来的 Tab 内容有效（title/summary/subtitle 非空）
	for i, tab := range meiguang.Tabs {
		if strings.TrimSpace(tab.Title) == "" {
			t.Fatalf("美光 Story Tab[%d] title 为空（backfill 产出无效）", i)
		}
		if strings.TrimSpace(tab.Summary) == "" {
			t.Fatalf("美光 Story Tab[%d] summary 为空（backfill 产出无效）", i)
		}
		if strings.TrimSpace(tab.Subtitle) == "" {
			t.Fatalf("美光 Story Tab[%d] subtitle 为空（backfill 产出无效）", i)
		}
	}

	// 所有 Story 的 Tab 都应 ≥ minStoryTabs（过 generateDataJSON 的硬报错闸）
	for i, g := range groups {
		if len(g.Tabs) < minStoryTabs {
			t.Fatalf("Story[%d] %q 只有 %d Tab（应 ≥%d，坑A 闸门）",
				i, g.Title, len(g.Tabs), minStoryTabs)
		}
	}

	// 写 data.json 验证最终产物合法
	reportPath := filepath.Join(dir, "data.json")
	if err := generateDataJSON(reportPath, groups, loaded); err != nil {
		t.Fatalf("generateDataJSON failed: %v", err)
	}
	data, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	var report DataJSON
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatalf("data.json 不是合法 JSON: %v", err)
	}
	if len(report.Stories) != 2 {
		t.Fatalf("期望 data.json 含 2 个 Story，实际 %d", len(report.Stories))
	}
	// 每个 Story 的 scenes 数应 ≥ minStoryTabs（Tab 和 scene 一一对应）
	for i, story := range report.Stories {
		if len(story.Scenes) < minStoryTabs {
			t.Fatalf("data.json Story[%d] 只有 %d 个 scene（应 ≥%d）",
				i, len(story.Scenes), minStoryTabs)
		}
	}
}

// TestBackfillStoryTabsProducesValidTabs 单元测试 backfillStoryTabs：
// 给一个 0 Tab 的 group，验证补齐到 minStoryTabs 且内容非空。
func TestBackfillStoryTabsProducesValidTabs(t *testing.T) {
	items := []Item{
		{
			ID: "guid-1", StableID: "topic-111", CanonicalID: "linuxdo:topic:111",
			SourceID: "linuxdo-news", SourceName: "LinuxDo",
			Title: "测试标题", Description: "测试正文摘要内容",
		},
	}
	group := NewsGroup{
		Title:         "测试标题",
		SourceIndexes: []int{1},
		Tabs:          []StoryTab{}, // 0 个 Tab，需要补齐
	}

	result := backfillStoryTabs(group, items, minStoryTabs)
	if len(result) < minStoryTabs {
		t.Fatalf("backfillStoryTabs 补齐到 %d 个 Tab，期望 ≥%d", len(result), minStoryTabs)
	}
	for i, tab := range result {
		if strings.TrimSpace(tab.Title) == "" {
			t.Fatalf("backfill Tab[%d] title 为空", i)
		}
		if strings.TrimSpace(tab.Summary) == "" {
			t.Fatalf("backfill Tab[%d] summary 为空", i)
		}
		if strings.TrimSpace(tab.Subtitle) == "" {
			t.Fatalf("backfill Tab[%d] subtitle 为空", i)
		}
		if tab.Kind == "" {
			t.Fatalf("backfill Tab[%d] kind 为空", i)
		}
		if len(tab.EvidenceIndexes) == 0 {
			t.Fatalf("backfill Tab[%d] evidence_indexes 为空", i)
		}
	}
}
