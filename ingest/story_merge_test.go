package main

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// 两个同事件粗分组 + 一个独立粗分组；LLM 决定合并前两个。
func TestApplyStoryMergeMergesSameEvent(t *testing.T) {
	groups := []NewsGroup{
		{Title: "GPT-5.6 分批发布", Score: 8, SourceIndexes: []int{1, 2}, Highlights: []NewsHighlight{{Index: 1, Point: "p1"}}},
		{Title: "GPT5.6 受政府要求分批", Score: 7, SourceIndexes: []int{3}, Highlights: []NewsHighlight{{Index: 3, Point: "p3"}}},
		{Title: "DeepSeek 扩张", Score: 9, SourceIndexes: []int{5}, Highlights: []NewsHighlight{{Index: 5, Point: "p5"}}},
	}
	results := []storyMergeResult{
		{MergedGroups: []int{1, 2}, Title: "美国政府要求 OpenAI 分批发布 GPT-5.6", NavigationTitle: "GPT-5.6", Highlights: []NewsHighlight{{Index: 1, Point: "p1"}, {Index: 3, Point: "p3"}}},
		{MergedGroups: []int{3}, Title: "DeepSeek 扩张", NavigationTitle: "DeepSeek", Highlights: []NewsHighlight{{Index: 5, Point: "p5"}}},
	}
	out, err := applyStoryMerge(groups, results, makeItems(5))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 stories, got %d", len(out))
	}
	// 找到合并后的故事（按标题识别）
	var merged *NewsGroup
	for i := range out {
		if out[i].Title == "美国政府要求 OpenAI 分批发布 GPT-5.6" {
			merged = &out[i]
			break
		}
	}
	if merged == nil {
		t.Fatalf("merged story not found in output")
	}
	if !reflect.DeepEqual(merged.SourceIndexes, []int{1, 2, 3}) {
		t.Errorf("merged SourceIndexes = %v, want [1 2 3]", merged.SourceIndexes)
	}
	if merged.Score != 8 {
		t.Errorf("merged Score = %d, want 8 (max)", merged.Score)
	}
	if merged.Title != "美国政府要求 OpenAI 分批发布 GPT-5.6" {
		t.Errorf("merged Title = %q", merged.Title)
	}
}

// LLM 漏掉一个粗分组 → 该粗分组兜底成独立 Story，不丢内容。
func TestApplyStoryMergeSalvagesOmittedGroups(t *testing.T) {
	groups := []NewsGroup{
		{Title: "A", Score: 6, SourceIndexes: []int{1}, Highlights: []NewsHighlight{{Index: 1, Point: "a"}}},
		{Title: "B", Score: 7, SourceIndexes: []int{2}, Highlights: []NewsHighlight{{Index: 2, Point: "b"}}},
	}
	results := []storyMergeResult{
		{MergedGroups: []int{1}, Title: "A", NavigationTitle: "A", Highlights: []NewsHighlight{{Index: 1, Point: "a"}}},
		// 漏掉 group 2
	}
	out, err := applyStoryMerge(groups, results, makeItems(2))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 stories (1 merged + 1 salvaged), got %d", len(out))
	}
}

// 同一输入粗分组被 LLM 重复归入两个输出 → 报错。
func TestApplyStoryMergeRejectsDuplicateAssignment(t *testing.T) {
	groups := []NewsGroup{
		{Title: "A", Score: 6, SourceIndexes: []int{1}, Highlights: []NewsHighlight{{Index: 1, Point: "a"}}},
	}
	results := []storyMergeResult{
		{MergedGroups: []int{1}, Title: "X", Highlights: []NewsHighlight{{Index: 1, Point: "a"}}},
		{MergedGroups: []int{1}, Title: "Y", Highlights: []NewsHighlight{{Index: 1, Point: "a"}}},
	}
	if _, err := applyStoryMerge(groups, results, makeItems(1)); err == nil {
		t.Fatal("want error for duplicate assignment, got nil")
	}
}

// makeItems 构造 n 条占位 Item（仅按索引对齐用）。
func makeItems(n int) []Item {
	items := make([]Item, n)
	for i := range items {
		items[i] = Item{Title: "t"}
	}
	return items
}

// jsonString 把任意字符串包成 JSON 字符串字面量（简易实现，足够测试用）。
func jsonString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// mock 模型返回合并 JSON，断言 mergeStoriesWithContent 调用 applyStoryMerge 产出合并结果。
func TestMergeStoriesWithContent(t *testing.T) {
	// FIXED: brief 原始 fixture 缺少 highlights 数组的闭合 ]，已补全为合法 JSON。
	body := `[{"merged_groups":[1,2],"title":"美国政府要求 OpenAI 分批发布 GPT-5.6","navigation_title":"GPT-5.6","highlights":[{"index":1,"point":"p1"}]},{"merged_groups":[3],"title":"DeepSeek 扩张","navigation_title":"DeepSeek","highlights":[{"index":5,"point":"p5"}]}]`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + jsonString(body) + `}}]}`))
	}))
	defer srv.Close()

	groups := []NewsGroup{
		{Title: "GPT-5.6 分批发布", Score: 8, SourceIndexes: []int{1}, Highlights: []NewsHighlight{{Index: 1, Point: "p1"}}},
		{Title: "GPT5.6 受政府要求", Score: 7, SourceIndexes: []int{2}, Highlights: []NewsHighlight{{Index: 2, Point: "p2"}}},
		{Title: "DeepSeek 扩张", Score: 9, SourceIndexes: []int{5}, Highlights: []NewsHighlight{{Index: 5, Point: "p5"}}},
	}
	ai := AIConfig{APIKey: "k", BaseURL: srv.URL, Model: "test"}
	out, err := mergeStoriesWithContent(ai, groups, makeItems(5))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 merged stories, got %d", len(out))
	}
	// 结果按 Score 降序：DeepSeek(9) 在前，GPT 合并(8) 在后；按标题识别合并条目。
	var merged *NewsGroup
	for i := range out {
		if out[i].Title == "美国政府要求 OpenAI 分批发布 GPT-5.6" {
			merged = &out[i]
			break
		}
	}
	if merged == nil {
		t.Fatalf("merged GPT story not found in output")
	}
	if !reflect.DeepEqual(merged.SourceIndexes, []int{1, 2}) {
		t.Errorf("merged SourceIndexes = %v, want [1 2]", merged.SourceIndexes)
	}
}
