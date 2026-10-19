package main

import (
	"fmt"
	"reflect"
	"testing"
)

func TestReadyWholeStorySurvivesAnUnrelatedInferiorRepair(t *testing.T) {
	for _, count := range []int{1, 3, maxStoryScenes} {
		groups := []NewsGroup{{Title: "模型权重开放", SourceIndexes: []int{1}}}
		batch := []storyTabMaterial{{GroupIndex: 1, Body: "Story 1"}}
		draft := fixtureCompleteStoryDraft()
		draft.Scenes = nil
		for i := 0; i < count; i++ {
			draft.Scenes = append(draft.Scenes, StoryScene{
				Subtitle:        fmt.Sprintf("研究团队第%d项实验结果采用完整测试条件，并公开对应模型权重与复现材料。", i+1),
				EvidenceIndexes: []int{1},
			})
		}
		draft.NarrationReview = fixtureNarrationReview(draft.Scenes)
		if repairs := applyStoryTabsResults(groups, batch, []StoryTabsResult{draft}); len(repairs) != 0 {
			t.Fatalf("valid %d-scene draft rejected: %#v", count, repairs)
		}
		before := groups[0]
		inferior := fixtureCompleteStoryDraft()
		inferior.NavigationTitle = "新标签"
		applyStoryTabsResults(groups, batch, []StoryTabsResult{inferior})
		if !reflect.DeepEqual(groups[0], before) {
			t.Fatalf("ready whole story was partially replaced: %#v", groups[0])
		}
	}
}

func TestRejectedSentenceCannotSilentlyNarrowAStory(t *testing.T) {
	groups := []NewsGroup{{Title: "模型权重开放", SourceIndexes: []int{1}}}
	batch := []storyTabMaterial{{GroupIndex: 1, Body: "Story 1"}}
	draft := fixtureCompleteStoryDraft()
	draft.Scenes = append(draft.Scenes, StoryScene{Subtitle: "太短", EvidenceIndexes: []int{1}})
	if repairs := applyStoryTabsResults(groups, batch, []StoryTabsResult{draft}); len(repairs) != 1 || len(groups[0].Scenes) != 0 {
		t.Fatalf("invalid sentence was silently dropped and the rest accepted: %#v", groups[0])
	}
}
