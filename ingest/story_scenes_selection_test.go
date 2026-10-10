package main

import "testing"

// 重写 Tabs 或标题时，已合格的完整讲解不能仅因超过两段就被短稿替换。
func TestBetterStoryScenesPreservesReadyNarrationAcrossRepairs(t *testing.T) {
	for _, count := range []int{3, maxStoryScenes} {
		current := make([]StoryScene, count)
		if betterStoryScenes(make([]StoryScene, 1), current) {
			t.Errorf("a one-scene repair replaced a valid %d-scene narration", count)
		}
		if !betterStoryScenes(current, make([]StoryScene, maxStoryScenes+1)) {
			t.Errorf("valid %d-scene narration did not replace an over-limit result", count)
		}
		if !betterStoryScenes(current, nil) {
			t.Errorf("valid %d-scene narration did not replace a missing result", count)
		}
	}
}
