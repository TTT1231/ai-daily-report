package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func suppliedTestLayout() navigationLayoutConfig {
	return navigationLayoutConfig{
		VideoWidth:             1920,
		TopComfortFillRatio:    0.88,
		MinimumItemWidth:       82,
		ItemGap:                4,
		ASCIIWidthFactor:       0.62,
		ItemChromeWidth:        18,
		BottomWindowItems:      5,
		BottomInactiveFontSize: 22,
		BottomActiveFontSize:   26,
		BottomHorizontalPad:    18,
		BottomActiveExtraGap:   12,
		BottomCounterWidth:     92,
		Layouts:                []navigationTypography{{MinItems: 0, FontSize: 24, HorizontalPadding: 10}},
	}
}

func TestValidateSuppliedEvidenceInputRejectsNonAdjacentCategories(t *testing.T) {
	sources := []suppliedSourceUnit{
		{Link: "https://example.com/1"},
		{Link: "https://example.com/2"},
		{Link: "https://example.com/3"},
	}
	input := suppliedEvidenceInput{
		Sources: sources,
		StoryPlan: []suppliedStoryPlan{
			{ID: "story-1", SourceIndexes: []int{1}, TopTitle: "模型", BottomTitle: "一"},
			{ID: "story-2", SourceIndexes: []int{2}, TopTitle: "应用", BottomTitle: "二"},
			{ID: "story-3", SourceIndexes: []int{3}, TopTitle: "模型", BottomTitle: "三"},
		},
	}
	errors := strings.Join(validateSuppliedEvidenceInput(input, suppliedTestLayout()), "\n")
	if !strings.Contains(errors, "multiple non-adjacent segments") {
		t.Fatalf("missing non-adjacent category error:\n%s", errors)
	}
}

func TestValidateSuppliedEvidenceInputAllowsEightShortCategories(t *testing.T) {
	input := suppliedEvidenceInput{}
	for index, category := range []string{"模型", "应用", "算力", "政策", "芯片", "汽车", "资本", "健康"} {
		input.Sources = append(input.Sources, suppliedSourceUnit{Link: fmt.Sprintf("https://example.com/%d", index+1)})
		input.StoryPlan = append(input.StoryPlan, suppliedStoryPlan{
			ID:            fmt.Sprintf("story-%d", index+1),
			SourceIndexes: []int{index + 1},
			TopTitle:      category,
			BottomTitle:   fmt.Sprintf("第%d条", index+1),
		})
	}
	layout := suppliedTestLayout()
	if errors := validateSuppliedEvidenceInput(input, layout); len(errors) != 0 {
		t.Fatalf("eight short categories should fit by measured width: %v", errors)
	}
	stats := suppliedNavigationStatsFor(input.StoryPlan, layout)
	if stats.Top.ItemCount != 10 || stats.Top.Density != "comfortable" {
		t.Fatalf("top navigation stats = %#v", stats.Top)
	}
}

func TestValidateSuppliedEvidenceInputRejectsActualTopWidthOverflow(t *testing.T) {
	input := suppliedEvidenceInput{}
	for index := 0; index < 8; index++ {
		input.Sources = append(input.Sources, suppliedSourceUnit{Link: fmt.Sprintf("https://example.com/%d", index+1)})
		input.StoryPlan = append(input.StoryPlan, suppliedStoryPlan{
			ID:            fmt.Sprintf("story-%d", index+1),
			SourceIndexes: []int{index + 1},
			TopTitle:      fmt.Sprintf("这是一个很长而且互不相同的栏目标题%d", index+1),
			BottomTitle:   fmt.Sprintf("第%d条", index+1),
		})
	}
	errors := strings.Join(validateSuppliedEvidenceInput(input, suppliedTestLayout()), "\n")
	if !strings.Contains(errors, "top navigation requires") {
		t.Fatalf("missing measured-width overflow error:\n%s", errors)
	}
}

func TestValidateSuppliedEvidenceInputSupportsExplicitMerge(t *testing.T) {
	input := suppliedEvidenceInput{
		Sources: []suppliedSourceUnit{
			{Link: "https://example.com/1"},
			{Link: "https://example.com/2"},
		},
		StoryPlan: []suppliedStoryPlan{
			{ID: "merged-story", SourceIndexes: []int{1, 2}, TopTitle: "模型", BottomTitle: "合并稿"},
		},
	}
	if errors := validateSuppliedEvidenceInput(input, suppliedTestLayout()); len(errors) != 0 {
		t.Fatalf("valid merged story plan rejected: %v", errors)
	}
}

func TestMatchSuppliedSourceUsesHashThenNormalizedLinkAndTopicID(t *testing.T) {
	state := RSSState{Items: map[string]StateItem{
		strings.Repeat("a", 64): {Title: "hash", Link: "https://example.com/hash"},
		strings.Repeat("b", 64): {Title: "link", Link: "https://example.com/article"},
		strings.Repeat("c", 64): {Title: "topic", Link: "https://linux.do/t/topic/12345"},
	}}
	if hash, _, method := matchSuppliedSource(suppliedSourceUnit{Hash: strings.Repeat("A", 64)}, state); method != "hash" || hash != strings.Repeat("a", 64) {
		t.Fatalf("hash match = %q/%q", hash, method)
	}
	if hash, _, method := matchSuppliedSource(suppliedSourceUnit{Link: "[https://example.com/article?utm_source=x](https://example.com/article?utm_source=x)"}, state); method != "link" || hash != strings.Repeat("b", 64) {
		t.Fatalf("link match = %q/%q", hash, method)
	}
	if hash, _, method := matchSuppliedSource(suppliedSourceUnit{Link: "https://linux.do/t/a-different-slug/12345?x=1"}, state); method != "topicId" || hash != strings.Repeat("c", 64) {
		t.Fatalf("topic match = %q/%q", hash, method)
	}
}

func TestExtractSuppliedExternalLinksDropsSourceImagesAndDuplicates(t *testing.T) {
	description := `<a href="https://linux.do/t/topic/1">source</a>
		<a href="https://example.com/article?utm_source=a">article</a>
		<a href="https://example.com/article?utm_source=b">duplicate</a>
		<a href="https://example.com/chart.png">image</a>`
	got := extractSuppliedExternalLinks(description, "https://linux.do/t/topic/1")
	if len(got) != 1 || got[0] != "https://example.com/article?utm_source=a" {
		t.Fatalf("external links = %#v", got)
	}
}

func TestBuildSuppliedSourceResultsIncludesHTMLAndLocalCandidates(t *testing.T) {
	sources := []suppliedSourceUnit{{
		Link:      "https://example.com/article",
		LocalPath: "C:/evidence/local.png",
		Content:   `<p><img src="https://cdn.example.com/chart.png"><a href="https://example.com/detail">detail</a></p>`,
	}}
	results := buildSuppliedSourceResults(sources, RSSState{Items: map[string]StateItem{}})
	if len(results) != 1 || len(results[0].Candidates) != 2 {
		t.Fatalf("source results = %#v", results)
	}
	if results[0].Candidates[0].Origin != "localInput" || results[0].Candidates[1].Origin != "inputContent" {
		t.Fatalf("candidate origins = %#v", results[0].Candidates)
	}
	if len(results[0].ExternalLinks) != 2 {
		t.Fatalf("external links = %#v", results[0].ExternalLinks)
	}
}

func TestBuildSuppliedSourceResultsTreatsDirectImageURLAsExplicitInput(t *testing.T) {
	results := buildSuppliedSourceResults(
		[]suppliedSourceUnit{{Link: "https://cdn.example.com/evidence.png"}},
		RSSState{Items: map[string]StateItem{}},
	)
	if len(results[0].Candidates) != 1 || results[0].Candidates[0].Origin != "directImageInput" {
		t.Fatalf("direct image candidate = %#v", results[0].Candidates)
	}
	if len(results[0].ExternalLinks) != 0 {
		t.Fatalf("direct image URL should not also be a page link: %#v", results[0].ExternalLinks)
	}
}

func TestPrepareSuppliedCandidatesKeepsExplicitSmallLocalImage(t *testing.T) {
	dir := t.TempDir()
	localPath := filepath.Join(dir, "explicit.png")
	if err := os.WriteFile(localPath, testPNG(t, 96, 96), 0o644); err != nil {
		t.Fatal(err)
	}
	sources := []suppliedSourceResult{{
		Index: 1,
		Candidates: []suppliedEvidenceCandidate{{
			Index: 1, Origin: "localInput", Path: localPath,
		}},
	}}
	if _, err := prepareSuppliedCandidateDownloads(sources, filepath.Join(dir, "work"), nil, 1); err != nil {
		t.Fatal(err)
	}
	candidate := sources[0].Candidates[0]
	if candidate.Status != "ready" || !candidate.Reviewable || sources[0].NoReviewableStateCandidate {
		t.Fatalf("explicit local candidate = %#v; source = %#v", candidate, sources[0])
	}
}

func TestPrepareSuppliedCandidatesFiltersDeduplicatesAndReusesCache(t *testing.T) {
	large := testPNG(t, 400, 300)
	small := testPNG(t, 128, 128)
	server := httptest.NewServer(httpHandler(map[string][]byte{
		"/large-a.png": large,
		"/large-b.png": large,
		"/small.png":   small,
	}))
	urls := []string{server.URL + "/large-a.png", server.URL + "/large-b.png", server.URL + "/small.png"}
	newSources := func() []suppliedSourceResult {
		candidates := make([]suppliedEvidenceCandidate, len(urls))
		for index, candidateURL := range urls {
			candidates[index] = suppliedEvidenceCandidate{Index: index + 1, URL: candidateURL}
		}
		return []suppliedSourceResult{{Index: 1, Input: suppliedSourceUnit{Link: server.URL}, Candidates: candidates}}
	}

	outputDir := t.TempDir()
	first := newSources()
	unique, err := prepareSuppliedCandidateDownloads(first, outputDir, server.Client(), 3)
	if err != nil {
		t.Fatal(err)
	}
	if unique != 3 {
		t.Fatalf("unique URLs = %d, want 3", unique)
	}
	statuses := []string{first[0].Candidates[0].Status, first[0].Candidates[1].Status, first[0].Candidates[2].Status}
	if strings.Join(statuses, ",") != "ready,duplicate,filtered" {
		t.Fatalf("statuses = %v", statuses)
	}
	if first[0].NoReviewableStateCandidate {
		t.Fatal("source with a ready candidate was marked as missing candidates")
	}

	server.Close()
	second := newSources()
	if _, err := prepareSuppliedCandidateDownloads(second, outputDir, server.Client(), 3); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range second[0].Candidates {
		if !candidate.CacheHit {
			t.Fatalf("candidate was not reused from cache: %#v", candidate)
		}
	}
}

func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			canvas.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 120, A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func httpHandler(responses map[string][]byte) *testHTTPHandler {
	return &testHTTPHandler{responses: responses}
}

type testHTTPHandler struct {
	responses map[string][]byte
}

func (handler *testHTTPHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	data, exists := handler.responses[request.URL.Path]
	if !exists {
		http.NotFound(writer, request)
		return
	}
	writer.Header().Set("Content-Type", "image/png")
	_, _ = writer.Write(data)
}
