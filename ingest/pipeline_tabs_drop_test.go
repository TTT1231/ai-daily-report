package main

import (
	"strings"
	"testing"
	"time"
)

// generateStoryTabs 在「部分 Story 的 AI Tabs 不达标」时直接剔除薄 Story、保留合格 Story，
// 不再走保底补齐或整期中止。本文件锁定这条契约：
//   - 部分丢：mock 对其中 1 个 group 返回的 tabs 因 evidence_indexes 无效全部被丢弃（<minStoryTabs），
//     另一个 group 返回 2 个合格 tab → 薄的剔除，合格的存活且 Tabs 完整。
//   - 全丢报错：mock 对全部 group 都凑不齐 minStoryTabs → 返回 error，信息含「AI Tabs 均不足」。
//
// 实现要点（避坑）：
//   - mock 首次即返合法 JSON（choices[0].message.content 为合法 StoryTabsResult 数组），不触发
//     requestStoryTabsBatchWithRetry 的退避 time.Sleep，靠 tab 内容不合规触发 drop。
//   - 让不合格 tab 在 normalizeStoryTabsWithReasons 阶段被丢：把 evidence_indexes 设成不在
//     group.SourceIndexes 里的序号 → 命中「evidence_indexes 未包含该 Story 的有效来源序号」分支。
//   - 合格 tab 的 evidence_indexes 必须落在对应 group 的 SourceIndexes 内，否则会被误丢。
//   - generateStoryTabs 内部对每个 group 调用 vision.analyzeItem，但 items 无远程图（Description 不含
//     <img>），不触发视觉识别，故无需 mock 视觉端点。

// twoPrebuiltGroups 构造两个来源不同的预聚类 group，避免 splitIncompatibleGroups / 保底机制干扰。
// 每组都用各自的 SourceIndexes，让 evidence_indexes 校验可在测试里精确控制。
func twoPrebuiltGroups() []NewsGroup {
	return []NewsGroup{
		{
			Title:         "薄 Story：将被剔除",
			Reason:        "测试用",
			SourceIndexes: []int{1},
			Highlights:    []NewsHighlight{{Index: 1, Point: "来源一"}},
		},
		{
			Title:         "合格 Story：应存活",
			Reason:        "测试用",
			SourceIndexes: []int{2},
			Highlights:    []NewsHighlight{{Index: 2, Point: "来源二"}},
		},
	}
}

func tabsDropItems() []Item {
	now := time.Date(2026, 6, 28, 9, 0, 0, 0, time.UTC)
	return []Item{
		{ID: "1", SourceID: "linuxdo", SourceName: "LinuxDo", Title: "来源一", Link: "https://example.com/1", PublishedAt: now, Description: "来源一正文。"},
		{ID: "2", SourceID: "linuxdo", SourceName: "LinuxDo", Title: "来源二", Link: "https://example.com/2", PublishedAt: now, Description: "来源二正文。"},
	}
}

// TestGenerateStoryTabsDropsStoryWithTooFewValidTabsAndKeepsGoodOne：部分丢契约。
// group 1（SourceIndexes=[1]）的两个 tab 都用 evidence_indexes=[99]（不在 [1] 内）→ 全被丢 → 0 合格。
// group 2（SourceIndexes=[2]）的两个 tab 都用 evidence_indexes=[2] → 合格 → 存活。
func TestGenerateStoryTabsDropsStoryWithTooFewValidTabsAndKeepsGoodOne(t *testing.T) {
	groups := twoPrebuiltGroups()
	items := tabsDropItems()

	// 两个 group 同属一个批次（storyTabBatchSize=4），一次 mock 响应覆盖。
	tabsJSON := `[` +
		`{"group_index":1,"tabs":[` +
		// 摘要够长（>=minTabSummaryRunes=20 字）但 evidence_indexes 全部无效 → 被丢
		`{"title":"薄Tab一","summary":"这是一段长度足够的摘要内容用于通过字数校验。","kind":"fact","evidence_indexes":[99]},` +
		`{"title":"薄Tab二","summary":"这是另一段长度足够的摘要内容用于通过字数校验。","kind":"fact","evidence_indexes":[99]}` +
		`]},` +
		`{"group_index":2,"tabs":[` +
		// 合格：evidence_indexes 命中 group 2 的 SourceIndexes=[2]
		`{"title":"合格Tab一","summary":"这是合格 Story 的第一段足够长的摘要内容。","kind":"fact","evidence_indexes":[2]},` +
		`{"title":"合格Tab二","summary":"这是合格 Story 的第二段足够长的摘要内容。","kind":"impact","evidence_indexes":[2]}` +
		`]}` +
		`]`
	server := fakeModelServer(t, tabsJSON)
	defer server.Close()

	ai := AIConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test-model"}
	kept, err := generateStoryTabs(ai, groups, items)
	if err != nil {
		t.Fatalf("generateStoryTabs returned error on partial drop: %v", err)
	}
	if len(kept) != 1 {
		t.Fatalf("expected 1 kept group (the good one), got %d: %#v", len(kept), kept)
	}
	if kept[0].Title != "合格 Story：应存活" {
		t.Fatalf("kept the wrong group: %#v", kept[0])
	}
	if len(kept[0].Tabs) < minStoryTabs {
		t.Fatalf("kept group has %d tabs, need ≥%d", len(kept[0].Tabs), minStoryTabs)
	}
	// 合格 Tab 的独有摘要短语必须保留（证明走的是 AI 路径，不是保底补齐）。
	var allSummaries string
	for _, tab := range kept[0].Tabs {
		allSummaries += tab.Summary
	}
	if !strings.Contains(allSummaries, "合格 Story") {
		t.Fatalf("expected mock-generated tab content to survive; got: %s", allSummaries)
	}
}

// TestGenerateStoryTabsErrorsWhenAllStoriesHaveTooFewValidTabs：全丢报错契约。
// 两个 group 的 tabs 全部因 evidence_indexes 无效被丢 → 0 合格 → 返回 error 含「AI Tabs 均不足」。
func TestGenerateStoryTabsErrorsWhenAllStoriesHaveTooFewValidTabs(t *testing.T) {
	groups := twoPrebuiltGroups()
	items := tabsDropItems()

	tabsJSON := `[` +
		`{"group_index":1,"tabs":[` +
		`{"title":"无效一","summary":"这是一段长度足够的摘要内容用于通过字数校验。","kind":"fact","evidence_indexes":[99]}` +
		`]},` +
		`{"group_index":2,"tabs":[` +
		`{"title":"无效二","summary":"这是另一段长度足够的摘要内容用于通过字数校验。","kind":"fact","evidence_indexes":[99]}` +
		`]}` +
		`]`
	server := fakeModelServer(t, tabsJSON)
	defer server.Close()

	ai := AIConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test-model"}
	_, err := generateStoryTabs(ai, groups, items)
	if err == nil {
		t.Fatal("expected error when all groups have too few valid tabs, got nil")
	}
	if !strings.Contains(err.Error(), "AI Tabs 均不足") {
		t.Fatalf("error should mention 「AI Tabs 均不足」, got: %v", err)
	}
}

// TestGenerateStoryTabsDropsStoryWithShortSummaryTabs：覆盖「summary 过短导致 tab 被丢」的 drop 路径。
// group 1 的两个 tab summary 都 < minTabSummaryRunes=20 字 → 被 tabRejectionReason 丢 → 0 合格。
// 与上一组用例互补：上一个用 evidence_indexes 失效，这个用 summary 过短，确认两种 drop 触发源都被覆盖。
func TestGenerateStoryTabsDropsStoryWithShortSummaryTabs(t *testing.T) {
	groups := twoPrebuiltGroups()
	items := tabsDropItems()

	tabsJSON := `[` +
		`{"group_index":1,"tabs":[` +
		// summary 过短 → tabRejectionReason 命中「summary 仅 N 字，不足 20 字下限」
		`{"title":"短一","summary":"太短","kind":"fact","evidence_indexes":[1]},` +
		`{"title":"短二","summary":"也太短","kind":"fact","evidence_indexes":[1]}` +
		`]},` +
		`{"group_index":2,"tabs":[` +
		`{"title":"合格一","summary":"这是合格 Story 的第一段足够长的摘要内容。","kind":"fact","evidence_indexes":[2]},` +
		`{"title":"合格二","summary":"这是合格 Story 的第二段足够长的摘要内容。","kind":"impact","evidence_indexes":[2]}` +
		`]}` +
		`]`
	server := fakeModelServer(t, tabsJSON)
	defer server.Close()

	ai := AIConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test-model"}
	kept, err := generateStoryTabs(ai, groups, items)
	if err != nil {
		t.Fatalf("generateStoryTabs returned error on short-summary partial drop: %v", err)
	}
	if len(kept) != 1 {
		t.Fatalf("expected 1 kept group, got %d: %#v", len(kept), kept)
	}
	if kept[0].Title != "合格 Story：应存活" {
		t.Fatalf("kept the wrong group: %#v", kept[0])
	}
}
