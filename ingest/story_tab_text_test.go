package main

import (
	"testing"
	"unicode/utf8"
)

// TestFallbackOverviewSummaryMeetsMinimum 锁定保底摘要的字数下限：
// 无论 Story 标题/理由为空、过短还是正常，fallbackOverviewSummary 都必须 >= minTabSummaryRunes，
// 否则该保底 Tab 会被 tabRejectionReason 丢弃。
func TestFallbackOverviewSummaryMeetsMinimum(t *testing.T) {
	cases := []struct {
		name   string
		group  NewsGroup
	}{
		{"empty", NewsGroup{Title: "", Reason: ""}},
		{"short", NewsGroup{Title: "GLM", Reason: "更新"}},
		{"only-title", NewsGroup{Title: "某模型", Reason: ""}},
		{"normal", NewsGroup{Title: "某厂商发布新模型", Reason: "性能提升明显，价格下调"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := fallbackOverviewSummary(tc.group)
			if utf8.RuneCountInString(got) < minTabSummaryRunes {
				t.Fatalf("fallbackOverviewSummary(Title=%q, Reason=%q) = %q (%d runes) < min %d",
					tc.group.Title, tc.group.Reason, got, utf8.RuneCountInString(got), minTabSummaryRunes)
			}
		})
	}
}

// TestFallbackStoryTabsReachMinimumWhenShort 是 #7 的回归测试：
// 标题与理由都偏短（"GLM。更新" 仅 5 字 < minTabSummaryRunes）时，保底 Tabs 仍须凑齐
// minStoryTabs 个有效 Tab，避免 withFallbackStoryTabs 失败 → generateDataJSON 整期 fatal 中止。
func TestFallbackStoryTabsReachMinimumWhenShort(t *testing.T) {
	group := NewsGroup{Title: "GLM", Reason: "更新", SourceIndexes: []int{1}}
	normalized := normalizeStoryTabs(group, fallbackStoryTabs(group))
	if len(normalized) < minStoryTabs {
		t.Fatalf("期望短标题/理由下保底 Tabs 仍 >= %d 个，实际 %d 个", minStoryTabs, len(normalized))
	}
}
