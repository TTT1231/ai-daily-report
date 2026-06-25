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
		name  string
		group NewsGroup
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
	cases := []struct {
		name   string
		reason string
	}{
		{"short", "更新"},
		{"short-with-period", "更新。"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			group := NewsGroup{Title: "GLM", Reason: tc.reason, SourceIndexes: []int{1}}
			normalized := normalizeStoryTabs(group, fallbackStoryTabs(group))
			if len(normalized) < minStoryTabs {
				t.Fatalf("期望短标题/理由下保底 Tabs 仍 >= %d 个，实际 %d 个", minStoryTabs, len(normalized))
			}
		})
	}
}

func TestEnrichTabSummaryMarkdownAddsMissingInlineCode(t *testing.T) {
	input := "Codex 中的 GPT 服务出现异常，持续报 **Service Unavailable** 错误，影响正常使用。"
	got := enrichTabSummaryMarkdown(input)
	want := "`Codex` 中的 GPT 服务出现异常，持续报 **Service Unavailable** 错误，影响正常使用。"
	if got != want {
		t.Fatalf("enrichTabSummaryMarkdown() = %q, want %q", got, want)
	}
}

func TestEnrichTabSummaryMarkdownAddsMissingBold(t *testing.T) {
	input := "随着`Jalapeño`的部署，OpenAI将能够通过自研硬件降低推理成本，影响API等服务定价。"
	got := enrichTabSummaryMarkdown(input)
	want := "随着`Jalapeño`的部署，OpenAI将能够通过自研硬件**降低推理成本**，影响API等服务定价。"
	if got != want {
		t.Fatalf("enrichTabSummaryMarkdown() = %q, want %q", got, want)
	}
}

func TestEnrichTabSummaryMarkdownAvoidsNestedMarkdown(t *testing.T) {
	input := "OpenAI 官网 JS 文件中出现 **gpt-5.6-preview** 条目，更新时间显示为 **2026 年 6 月 25 日**。"
	got := enrichTabSummaryMarkdown(input)
	want := "`OpenAI` 官网 JS 文件中出现 **gpt-5.6-preview** 条目，更新时间显示为 **2026 年 6 月 25 日**。"
	if got != want {
		t.Fatalf("enrichTabSummaryMarkdown() = %q, want %q", got, want)
	}
}

func TestEnrichTabSummaryMarkdownSplitsCodeCandidateOutOfBold(t *testing.T) {
	input := "网友发现该预览模型条目后，普遍预期 **GPT-5.6 即将上线**，可能带来能力提升。"
	got := enrichTabSummaryMarkdown(input)
	want := "网友发现该预览模型条目后，普遍预期 `GPT-5.6` **即将上线**，可能带来能力提升。"
	if got != want {
		t.Fatalf("enrichTabSummaryMarkdown() = %q, want %q", got, want)
	}
}

func TestNormalizeStoryTabsEnrichesSummaryMarkdown(t *testing.T) {
	group := NewsGroup{SourceIndexes: []int{1}}
	tabs := []StoryTab{{
		Title:           "服务不可用",
		Summary:         "Codex 中的 GPT 服务出现异常，持续报 **Service Unavailable** 错误，影响正常使用。",
		Subtitle:        "Codex 中的 GPT 服务出现异常，持续报 Service Unavailable 错误，影响正常使用。",
		Kind:            "fact",
		EvidenceIndexes: []int{1},
	}}
	got := normalizeStoryTabs(group, tabs)
	if len(got) != 1 {
		t.Fatalf("normalizeStoryTabs() len = %d, want 1", len(got))
	}
	if got[0].Summary != "`Codex` 中的 GPT 服务出现异常，持续报 **Service Unavailable** 错误，影响正常使用。" {
		t.Fatalf("summary = %q", got[0].Summary)
	}
}
