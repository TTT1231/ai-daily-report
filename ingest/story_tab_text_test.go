package main

import (
	"strings"
	"testing"
)

func TestSplitBoldSpanForInlineCodeKeepsMiddleCandidateInSingleBoldSpan(t *testing.T) {
	input := "官方确认 **现有 Codex 用户继续保留访问资格**，迁移安排稍后公布。"
	got := splitBoldSpanForInlineCode(input)
	if got != input {
		t.Fatalf("splitBoldSpanForInlineCode() = %q, want unchanged %q", got, input)
	}
	if spans := tabSummaryBoldSpanPattern.FindAllString(got, -1); len(spans) != 1 {
		t.Fatalf("bold spans = %d, want 1 in %q", len(spans), got)
	}
}

func TestEnrichTabSummaryMarkdownDoesNotCreateRejectedMiddleCodeShape(t *testing.T) {
	input := "官方确认 **现有 Codex 用户继续保留访问资格**，迁移安排稍后公布。"
	got := enrichTabSummaryMarkdown(input)
	if reason := tabRejectionReason(StoryTab{Title: "迁移安排", Summary: got}); reason != "" {
		t.Fatalf("enricher produced a shape rejected by its validator: %q (%s)", got, reason)
	}
}

func TestNormalizeStoryTabsRejectsTitleMatchingResolvedContentTitle(t *testing.T) {
	group := NewsGroup{
		Title:         "这是一个超过三十个字符并且需要模型语义改写后才能放入视频播放区的新闻原标题",
		ContentTitle:  "模型语义改写后的完整短标题",
		SourceIndexes: []int{1},
	}
	tabs := []StoryTab{{
		Title:           group.ContentTitle,
		Summary:         "这是一段长度足够的完整摘要，用于验证跨层标题重复会被准确拒绝。",
		EvidenceIndexes: []int{1},
	}}
	normalized, rejected := normalizeStoryTabsWithReasons(group, tabs)
	if len(normalized) != 0 || len(rejected) != 1 || !strings.Contains(rejected[0].Reason, "完整 Story 标题") {
		t.Fatalf("normalizeStoryTabsWithReasons() = %#v / %#v", normalized, rejected)
	}
}

func TestApplyStoryTabsResultsKeepsBestComponentsAcrossRepairRounds(t *testing.T) {
	groups := []NewsGroup{{
		Title:         "这是一个超过三十个字符并且需要模型语义改写后才能放入视频播放区的新闻原标题",
		SourceIndexes: []int{1},
	}}
	batch := []storyTabMaterial{{GroupIndex: 1, Body: "Story 1"}}
	validTabs := []StoryTab{
		{Title: "事件事实", Summary: "这是第一段长度足够的完整摘要，包含明确事实和具体结果。", EvidenceIndexes: []int{1}},
		{Title: "用户影响", Summary: "这是第二段长度足够的完整摘要，说明变化会怎样影响用户。", EvidenceIndexes: []int{1}},
	}
	validScenes := []StoryScene{{
		Subtitle:        "这是一条长度足够的完整口播，概括新闻主体、核心事件和直接结果。",
		EvidenceIndexes: []int{1},
	}}

	repairs := applyStoryTabsResults(groups, batch, []StoryTabsResult{{
		GroupIndex:      1,
		ContentTitle:    "首轮生成的完整短标题",
		NavigationTitle: "首轮事件",
		Tabs:            validTabs,
	}})
	if len(repairs) != 1 || len(groups[0].Tabs) != 2 {
		t.Fatalf("first round did not retain valid tabs: repairs=%#v group=%#v", repairs, groups[0])
	}

	repairs = applyStoryTabsResults(groups, batch, []StoryTabsResult{{
		GroupIndex:      1,
		ContentTitle:    "次轮不应覆盖的完整短标题",
		NavigationTitle: "次轮事件",
		Tabs: []StoryTab{{
			Title: "退化结果", Summary: "太短", EvidenceIndexes: []int{1},
		}},
		Scenes: validScenes,
	}})
	if len(repairs) != 0 || !storyTabsContentReady(groups[0]) {
		t.Fatalf("best components were not merged into a ready story: repairs=%#v group=%#v", repairs, groups[0])
	}
	if len(groups[0].Tabs) != 2 || len(groups[0].Scenes) != 1 {
		t.Fatalf("unexpected retained component counts: Tabs=%d Scenes=%d", len(groups[0].Tabs), len(groups[0].Scenes))
	}
}
