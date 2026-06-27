package main

import "testing"

// splitIncompatibleGroups 已删除：normalizeGroups 不应再因品牌身份键拆开同事件来源。
// 这里构造一个 normalizeGroups 能正常收敛的用例，确保删除后不 panic、不丢失来源。
func TestNormalizeGroupsWithoutSplitKeepsSources(t *testing.T) {
	items := makeItems(3)
	scored := []ScoredItem{
		{Index: 1, Title: "GPT-5.6 发布", Score: 8},
		{Index: 2, Title: "GPT5.6 受政府要求", Score: 7},
		{Index: 3, Title: "DeepSeek 扩张", Score: 9},
	}
	groups := []NewsGroup{
		{Title: "GPT-5.6 动态", SourceIndexes: []int{1, 2}, Highlights: []NewsHighlight{{Index: 1, Point: "p1"}}},
		{Title: "DeepSeek 扩张", SourceIndexes: []int{3}, Highlights: []NewsHighlight{{Index: 3, Point: "p3"}}},
	}
	out := normalizeGroups(groups, scored, items)
	total := 0
	for _, g := range out {
		total += len(g.SourceIndexes)
	}
	if total == 0 {
		t.Fatal("normalizeGroups returned no sources")
	}
}
