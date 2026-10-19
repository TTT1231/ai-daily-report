package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// Model fixtures explicitly return the editorial metadata required by production.
func fixtureNarrationReview(scenes []StoryScene) NarrationReview {
	review := NarrationReview{}
	for _, scene := range scenes {
		if review.Takeaway == "" {
			review.Takeaway = scene.Subtitle
		}
		review.CoreFacts = append(review.CoreFacts, NarrationCoreFact{
			Fact: scene.Subtitle, SpokenEvidence: scene.Subtitle, EvidenceIndexes: scene.EvidenceIndexes,
		})
	}
	return review
}

func fixtureCompleteStoryDraft() StoryTabsResult {
	draft := StoryTabsResult{GroupIndex: 1, ContentTitle: "完整的新闻标题", NavigationTitle: "测试项",
		Tabs: []StoryTab{
			{Title: "开放方式", Summary: "研究团队公布了完整的模型权重，**允许研究者下载并自行部署使用**。", EvidenceIndexes: []int{1}},
			{Title: "上下文容量", Summary: "本次模型版本提供一百万上下文窗口，**可以处理较长的输入材料内容**。", EvidenceIndexes: []int{1}},
		},
		Scenes: []StoryScene{{Subtitle: "研究团队开放模型权重供下载使用，并提供一百万上下文窗口处理长材料。", EvidenceIndexes: []int{1}}},
	}
	draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
	return draft
}

func fixtureStoryTabsJSON(t *testing.T, content string) string {
	t.Helper()
	var results []StoryTabsResult
	if err := json.Unmarshal([]byte(content), &results); err != nil {
		t.Fatal(err)
	}
	for i := range results {
		results[i].NarrationReview = fixtureNarrationReview(results[i].Scenes)
	}
	encoded, err := json.Marshal(results)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func TestNarrationReviewRejectsCoreInformationOnlyPresentInTabs(t *testing.T) {
	group := NewsGroup{SourceIndexes: []int{1},
		Tabs:   []StoryTab{{Summary: "模型权重已开放下载。"}},
		Scenes: []StoryScene{{Subtitle: "模型支持一百万上下文。", EvidenceIndexes: []int{1}}},
		NarrationReview: NarrationReview{Takeaway: "模型开放权重", CoreFacts: []NarrationCoreFact{
			{Fact: "模型权重已开放下载", SpokenEvidence: "模型权重已开放下载。", EvidenceIndexes: []int{1}},
		}},
	}
	if reasons := narrationRejectionReasons(group); len(reasons) == 0 || !strings.Contains(strings.Join(reasons, "\n"), "不能用标题或 Tab 代替") {
		t.Fatalf("unspoken core fact was accepted: %v", reasons)
	}
	group.Scenes[0].Subtitle = "模型权重已开放下载。支持一百万上下文。"
	if reasons := narrationRejectionReasons(group); len(reasons) != 0 {
		t.Fatalf("spoken core fact was rejected: %v", reasons)
	}
}

func TestNarrationReviewRequiresActualSceneSourcesAndExplicitEditorChoice(t *testing.T) {
	group := NewsGroup{SourceIndexes: []int{1, 2}, Scenes: []StoryScene{
		{Subtitle: "模型权重已开放下载。", EvidenceIndexes: []int{1}},
	}}
	if len(narrationRejectionReasons(group)) == 0 {
		t.Fatal("missing editorial choice passed")
	}
	group.NarrationReview = fixtureNarrationReview(group.Scenes)
	for _, indexes := range [][]int{nil, {2}, {99}, {1, 1}} {
		group.NarrationReview.CoreFacts[0].EvidenceIndexes = indexes
		if len(narrationRejectionReasons(group)) == 0 {
			t.Fatalf("unsupported core fact sources passed: %v", indexes)
		}
	}
}

func TestStoryTabsAcceptsCompleteOneFactBrief(t *testing.T) {
	draft := fixtureCompleteStoryDraft()
	draft.Tabs = draft.Tabs[:1]
	draft.Scenes[0].Subtitle = "研究团队开放模型权重，研究人员可以下载权重并自行部署使用。"
	draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
	groups := []NewsGroup{{Title: "模型开放权重", SourceIndexes: []int{1}}}
	batch := []storyTabMaterial{{GroupIndex: 1, Body: "模型开放权重的来源正文"}}
	if repairs := applyStoryTabsResults(groups, batch, []StoryTabsResult{draft}); len(repairs) != 0 {
		t.Fatalf("complete brief requested filler or repair: %v", repairs)
	}
	if !storyTabsContentReady(groups[0]) || len(groups[0].Tabs) != 1 {
		t.Fatalf("one-fact brief was not retained intact: %+v", groups[0])
	}
}
