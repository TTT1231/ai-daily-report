package main

import (
	"strings"
	"testing"
)

func TestAddMissingInlineCodeSpansCompletesMultipleEntities(t *testing.T) {
	input := "`WordPress` 的 wp2shell 漏洞影响 Cloudflare API 网关的安全状态。"
	got := addMissingInlineCodeSpans(input)
	for _, want := range []string{"`WordPress`", "`wp2shell`", "`Cloudflare`", "`API`"} {
		if !strings.Contains(got, want) {
			t.Fatalf("addMissingInlineCodeSpans() = %q, missing %s", got, want)
		}
	}
	if spans := tabSummaryCodeSpanPattern.FindAllString(got, -1); len(spans) != 4 {
		t.Fatalf("code spans = %d, want 4 in %q", len(spans), got)
	}
}

func TestEnrichTabSummaryMarkdownKeepsSingleBoldWithMultipleCodeSpans(t *testing.T) {
	input := "WordPress 的 wp2shell 漏洞允许未认证攻击者远程执行代码，Cloudflare API 网关可能受影响。"
	got := enrichTabSummaryMarkdown(input)
	if spans := tabSummaryBoldSpanPattern.FindAllString(got, -1); len(spans) != 1 {
		t.Fatalf("bold spans = %d, want 1 in %q", len(spans), got)
	}
	if spans := tabSummaryCodeSpanPattern.FindAllString(got, -1); len(spans) < 2 {
		t.Fatalf("code spans = %d, want multiple in %q", len(spans), got)
	}
	if reason := tabRejectionReason(StoryTab{Title: "迁移安排", Summary: got}); reason != "" {
		t.Fatalf("enricher produced a shape rejected by its validator: %q (%s)", got, reason)
	}
}

func TestEnrichTabSummaryMarkdownHighlightsDecoyFontMechanism(t *testing.T) {
	input := "该字体基于混合图像技术，人类正常阅读时看到隐藏信息，而 AI 因依赖近像素信息，优先读取轮廓更清晰的诱饵字母。"
	got := enrichTabSummaryMarkdown(input)
	if !strings.Contains(got, "**优先读取轮廓更清晰的诱饵字母**") {
		t.Fatalf("enrichTabSummaryMarkdown() = %q, want semantic conclusion emphasized", got)
	}
	if reason := tabRejectionReason(StoryTab{Title: "混合图像机制", Summary: got}); reason != "" {
		t.Fatalf("enriched summary rejected: %s (%q)", reason, got)
	}
}

func TestEnrichTabSummaryMarkdownDeepensWp2ShellEmphasis(t *testing.T) {
	input := "WordPress 核心漏洞 `wp2shell` 允许未认证攻击者通过匿名 HTTP 请求远程执行代码，即使未安装插件也受影响。"
	got := enrichTabSummaryMarkdown(input)
	if !strings.Contains(got, "`wp2shell`") {
		t.Fatalf("enrichTabSummaryMarkdown() lost inline code: %q", got)
	}
	if !strings.Contains(got, "`WordPress`") {
		t.Fatalf("enrichTabSummaryMarkdown() did not complete other inline code: %q", got)
	}
	if !strings.Contains(got, "**允许未认证攻击者通过匿名 HTTP 请求远程执行代码**") {
		t.Fatalf("enrichTabSummaryMarkdown() = %q, want impact emphasized", got)
	}
	if reason := tabRejectionReason(StoryTab{Title: "核心漏洞", Summary: got}); reason != "" {
		t.Fatalf("enriched summary rejected: %s (%q)", reason, got)
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
