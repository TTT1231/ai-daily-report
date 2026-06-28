package main

import (
	"testing"
)

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
