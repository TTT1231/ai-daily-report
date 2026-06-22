package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func imgItem(link, desc string) Item {
	return Item{Link: link, Description: desc}
}

// buildReport builds a DataJSON whose stories are already in final (post-compaction)
// order, each tagged with the groups index it came from and one scene per tab.
func buildReport(groups []NewsGroup) DataJSON {
	var report DataJSON
	// Caller pre-arranges the desired final order via the order of `groups` passed in;
	// we mirror that order and tag sourceGroupIndex so planManualCandidates can map back.
	for i := range groups {
		story := DataJSONStory{sourceGroupIndex: i}
		for range groups[i].Tabs {
			story.Scenes = append(story.Scenes, DataJSONScene{})
		}
		report.Stories = append(report.Stories, story)
	}
	return report
}

func TestPlanManualCandidates_ScoreGate(t *testing.T) {
	groups := []NewsGroup{
		{Score: 9, Tabs: []StoryTab{{EvidenceIndexes: []int{1}}}},
		{Score: 8, Tabs: []StoryTab{{EvidenceIndexes: []int{2}}}}, // below 9 → skipped
	}
	items := []Item{
		imgItem("https://src/1", `<img src="https://cdn/a.png">`),
		imgItem("https://src/2", `<img src="https://cdn/b.png">`),
	}
	got := planManualCandidates(buildReport(groups), groups, items, 2)
	want := []plannedManualImage{
		{SceneNum: 1, Candidate: 1, ImageURL: "https://cdn/a.png", RefererLink: "https://src/1"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("planManualCandidates() = %#v, want %#v", got, want)
	}
}

func TestPlanManualCandidates_PerSceneCapAndNumbering(t *testing.T) {
	// One story, two scenes. Scene 1 has 3 candidate URLs (cap=2); scene 2 has 1.
	groups := []NewsGroup{
		{Score: 10, Tabs: []StoryTab{
			{EvidenceIndexes: []int{1}}, // scene 1
			{EvidenceIndexes: []int{2}}, // scene 2
		}},
	}
	items := []Item{
		imgItem("https://src/1", `<img src="https://cdn/x.png"><img src="https://cdn/y.png"><img src="https://cdn/z.png">`),
		imgItem("https://src/2", `<img src="https://cdn/w.png">`),
	}
	got := planManualCandidates(buildReport(groups), groups, items, 2)
	want := []plannedManualImage{
		{SceneNum: 1, Candidate: 1, ImageURL: "https://cdn/x.png", RefererLink: "https://src/1"},
		{SceneNum: 1, Candidate: 2, ImageURL: "https://cdn/y.png", RefererLink: "https://src/1"},
		{SceneNum: 2, Candidate: 1, ImageURL: "https://cdn/w.png", RefererLink: "https://src/2"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("planManualCandidates() = %#v, want %#v", got, want)
	}
}

func TestPlanManualCandidates_FollowsFinalStoryOrder(t *testing.T) {
	// Two groups; report.Stories is in reversed order (simulating compaction reordering).
	groups := []NewsGroup{
		{Score: 9, Tabs: []StoryTab{{EvidenceIndexes: []int{1}}}}, // group 0
		{Score: 9, Tabs: []StoryTab{{EvidenceIndexes: []int{2}}}}, // group 1
	}
	items := []Item{
		imgItem("https://src/1", `<img src="https://cdn/a.png">`),
		imgItem("https://src/2", `<img src="https://cdn/b.png">`),
	}
	// Reversed final order: story from group 1 first, then group 0.
	report := DataJSON{Stories: []DataJSONStory{
		{sourceGroupIndex: 1, Scenes: []DataJSONScene{{}}},
		{sourceGroupIndex: 0, Scenes: []DataJSONScene{{}}},
	}}
	got := planManualCandidates(report, groups, items, 2)
	want := []plannedManualImage{
		{SceneNum: 1, Candidate: 1, ImageURL: "https://cdn/b.png", RefererLink: "https://src/2"},
		{SceneNum: 2, Candidate: 1, ImageURL: "https://cdn/a.png", RefererLink: "https://src/1"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("planManualCandidates() = %#v, want %#v", got, want)
	}
}

func TestDownloadManualCandidateImages_WritesSceneFiles(t *testing.T) {
	t.Setenv("all_proxy", "")
	png := onePixelPNG()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write(png)
	}))
	defer srv.Close()

	groups := []NewsGroup{
		{Score: 9, Tabs: []StoryTab{{EvidenceIndexes: []int{1}}}},
	}
	items := []Item{
		imgItem("https://src/1", `<img src="`+srv.URL+`/a.png">`),
	}
	report := buildReport(groups)
	root := t.TempDir()

	if err := downloadManualCandidateImages(newHTTPClient(defaultFeedRequestTimeout, false, false), report, groups, items, root); err != nil {
		t.Fatalf("downloadManualCandidateImages() error: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(root, "data-scheme", "images", "scene-1-1.png"))
	if err != nil {
		t.Fatalf("scene-1-1.png not written: %v", err)
	}
	if len(got) != len(png) {
		t.Errorf("scene-1-1.png bytes = %d, want %d", len(got), len(png))
	}
}
func TestGenerateDataJSON_VisionOffDoesNotAttachAndTriggersNoDownload(t *testing.T) {
	t.Setenv("CLAUDE_VISION_ENABLED", "false")
	// No remote images in descriptions -> plan is empty -> no files written anywhere.
	groups := []NewsGroup{{
		Title:         "测试 vision-off 不自动配图",
		Reason:        "验证纯文本模型下 data.json 不带 overlayImg",
		Score:         9,
		SourceIndexes: []int{1},
		Highlights:    []NewsHighlight{{Index: 1, Point: "来源一"}},
		Tabs: []StoryTab{
			{Title: "要点一", Summary: "这是足够长的摘要内容用于通过字数校验。", EvidenceIndexes: []int{1}},
			{Title: "要点二", Summary: "这是另一段足够长的摘要内容用于通过字数校验。", EvidenceIndexes: []int{1}},
		},
	}}
	items := []Item{{Title: "来源一", SourceID: "s", Link: "https://example.com/one", Description: "纯文本正文，没有图片"}}
	path := filepath.Join(t.TempDir(), "data.json")

	if err := generateDataJSON(path, groups, items); err != nil {
		t.Fatalf("generateDataJSON() error: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read data.json: %v", err)
	}
	if strings.Contains(string(data), "overlayImg") {
		t.Errorf("vision-off must not write overlayImg, got: %s", data)
	}
}