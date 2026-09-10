package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const defaultSuppliedEvidenceConcurrency = 4

var (
	suppliedHTTPURLPattern = regexp.MustCompile(`https?://[^\s<>\]]+`)
	suppliedHrefPattern    = regexp.MustCompile(`(?i)\bhref=["']([^"']+)["']`)
	linuxDoTopicPattern    = regexp.MustCompile(`(?i)linux\.do/t/(?:[^/]+/)?([0-9]+)`)
	hexHashPattern         = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

// suppliedEvidenceInput is intentionally small. The calling agent materializes one
// deterministic manifest in an OS-temp workspace before doing any browsing. storyPlan
// exists so navigation constraints fail before candidate downloads or page capture.
type suppliedEvidenceInput struct {
	Sources   []suppliedSourceUnit `json:"sources"`
	StoryPlan []suppliedStoryPlan  `json:"storyPlan"`
}

type suppliedSourceUnit struct {
	Hash      string `json:"hash,omitempty"`
	SourceID  string `json:"sourceId,omitempty"`
	Title     string `json:"title,omitempty"`
	Link      string `json:"link,omitempty"`
	LocalPath string `json:"localPath,omitempty"`
	Content   string `json:"content,omitempty"`
}

type suppliedStoryPlan struct {
	ID            string `json:"id"`
	SourceIndexes []int  `json:"sourceIndexes"`
	TopTitle      string `json:"topTitle"`
	BottomTitle   string `json:"bottomTitle"`
}

type suppliedEvidenceManifest struct {
	SchemaVersion int                     `json:"schemaVersion"`
	GeneratedAt   time.Time               `json:"generatedAt"`
	InputPath     string                  `json:"inputPath"`
	StatePath     string                  `json:"statePath"`
	OutputDir     string                  `json:"outputDir"`
	StoryPlan     []suppliedStoryPlan     `json:"storyPlan"`
	Navigation    suppliedNavigationStats `json:"navigation"`
	Sources       []suppliedSourceResult  `json:"sources"`
	Summary       suppliedEvidenceSummary `json:"summary"`
	TimingsMs     map[string]int64        `json:"timingsMs"`
}

type suppliedNavigationStats struct {
	Top    suppliedNavigationRow `json:"top"`
	Bottom suppliedNavigationRow `json:"bottom"`
}

type suppliedNavigationRow struct {
	Labels           []string `json:"labels"`
	ItemCount        int      `json:"itemCount"`
	AvailableWidth   int      `json:"availableWidth"`
	RequiredWidth    float64  `json:"requiredWidth"`
	FillRatio        float64  `json:"fillRatio"`
	ComfortFillRatio float64  `json:"comfortFillRatio,omitempty"`
	Density          string   `json:"density,omitempty"`
}

type suppliedSourceResult struct {
	Index                      int                         `json:"index"`
	Input                      suppliedSourceUnit          `json:"input"`
	MatchedBy                  string                      `json:"matchedBy"`
	StateHash                  string                      `json:"stateHash,omitempty"`
	StateItem                  *StateItem                  `json:"stateItem,omitempty"`
	ExternalLinks              []string                    `json:"externalLinks,omitempty"`
	Candidates                 []suppliedEvidenceCandidate `json:"candidates"`
	NoReviewableStateCandidate bool                        `json:"noReviewableStateCandidate"`
}

type suppliedEvidenceCandidate struct {
	Index       int    `json:"index"`
	Origin      string `json:"origin"`
	URL         string `json:"url,omitempty"`
	Status      string `json:"status"`
	Reviewable  bool   `json:"reviewable"`
	Path        string `json:"path,omitempty"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	Bytes       int    `json:"bytes,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	CacheHit    bool   `json:"cacheHit,omitempty"`
	DuplicateOf string `json:"duplicateOf,omitempty"`
	Reason      string `json:"reason,omitempty"`
	DownloadMs  int64  `json:"downloadMs,omitempty"`
}

type suppliedEvidenceSummary struct {
	SourceUnits                   int `json:"sourceUnits"`
	PlannedStories                int `json:"plannedStories"`
	TopTitleCategories            int `json:"topTitleCategories"`
	StateMatches                  int `json:"stateMatches"`
	UnmatchedSources              int `json:"unmatchedSources"`
	CandidateReferences           int `json:"candidateReferences"`
	UniqueCandidateURLs           int `json:"uniqueCandidateUrls"`
	ReviewableCandidateReferences int `json:"reviewableCandidateReferences"`
	FilteredCandidateReferences   int `json:"filteredCandidateReferences"`
	DuplicateCandidateReferences  int `json:"duplicateCandidateReferences"`
	FailedCandidateReferences     int `json:"failedCandidateReferences"`
	CacheHits                     int `json:"cacheHits"`
	SourcesWithoutStateCandidates int `json:"sourcesWithoutStateCandidates"`
}

type suppliedCandidateJob struct {
	URL     string
	Referer string
}

type suppliedCandidateDownload struct {
	Path       string
	Width      int
	Height     int
	Bytes      int
	SHA256     string
	CacheHit   bool
	DownloadMs int64
	Err        error
}

func runPrepareSuppliedEvidence(args []string) int {
	flags := flag.NewFlagSet("prepare-supplied-evidence", flag.ContinueOnError)
	inputPath := flags.String("input", "", "JSON manifest containing sources and storyPlan")
	outputDir := flags.String("output", "", "OS-temp workspace for candidates and manifest.json")
	statePath := flags.String("state", "", "rss-state.json path (defaults to ingest/rss-state.json)")
	concurrency := flags.Int("concurrency", defaultSuppliedEvidenceConcurrency, "parallel candidate downloads (1-8)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*inputPath) == "" {
		fmt.Println("失败：缺少 --input <sources.json>。")
		return 2
	}
	if *concurrency < 1 || *concurrency > 8 {
		fmt.Println("失败：--concurrency 必须在 1 到 8 之间。")
		return 2
	}

	startedAt := time.Now()
	input, absoluteInput, err := loadSuppliedEvidenceInput(*inputPath)
	if err != nil {
		fmt.Printf("失败：无法读取 supplied-source 预检输入：%v\n", err)
		return 1
	}
	layout, err := loadNavigationLayout()
	if err != nil {
		fmt.Printf("失败：无法读取导航布局：%v\n", err)
		return 1
	}
	if errors := validateSuppliedEvidenceInput(input, layout); len(errors) > 0 {
		fmt.Printf("Supplied-source plan validation failed with %d error(s):\n", len(errors))
		for _, validationError := range errors {
			fmt.Printf("- %s\n", validationError)
		}
		fmt.Println("未下载任何候选图；请一次性修正 storyPlan 后重试。")
		return 1
	}
	planReadyAt := time.Now()

	root, err := projectRoot()
	if err != nil {
		fmt.Printf("失败：%v\n", err)
		return 1
	}
	resolvedStatePath := strings.TrimSpace(*statePath)
	if resolvedStatePath == "" {
		resolvedStatePath = filepath.Join(root, filepath.FromSlash(rssStateRelativePath))
	} else if resolvedStatePath, err = filepath.Abs(resolvedStatePath); err != nil {
		fmt.Printf("失败：无法解析 --state：%v\n", err)
		return 1
	}
	state, err := loadRSSState(resolvedStatePath)
	if err != nil {
		fmt.Printf("失败：无法读取 RSS state：%v\n", err)
		return 1
	}
	sources := buildSuppliedSourceResults(input.Sources, state)
	stateReadyAt := time.Now()

	resolvedOutputDir := strings.TrimSpace(*outputDir)
	if resolvedOutputDir == "" {
		resolvedOutputDir, err = os.MkdirTemp("", "ai-daily-report-supplied-evidence-")
	} else {
		resolvedOutputDir, err = filepath.Abs(resolvedOutputDir)
		if err == nil {
			err = os.MkdirAll(resolvedOutputDir, 0o755)
		}
	}
	if err != nil {
		fmt.Printf("失败：无法创建证据工作区：%v\n", err)
		return 1
	}
	if err := loadProjectEnv(); err != nil {
		fmt.Printf("失败：无法加载项目网络配置：%v\n", err)
		return 1
	}
	client := newHTTPClient(defaultFeedRequestTimeout, false, true)
	uniqueURLs, err := prepareSuppliedCandidateDownloads(sources, resolvedOutputDir, client, *concurrency)
	if err != nil {
		fmt.Printf("失败：候选图准备失败：%v\n", err)
		return 1
	}
	downloadReadyAt := time.Now()

	summary := summarizeSuppliedEvidence(input, sources, uniqueURLs)
	navigation := suppliedNavigationStatsFor(input.StoryPlan, layout)
	manifest := suppliedEvidenceManifest{
		SchemaVersion: 2,
		GeneratedAt:   time.Now().UTC(),
		InputPath:     absoluteInput,
		StatePath:     resolvedStatePath,
		OutputDir:     resolvedOutputDir,
		StoryPlan:     input.StoryPlan,
		Navigation:    navigation,
		Sources:       sources,
		Summary:       summary,
		TimingsMs: map[string]int64{
			"planValidation": planReadyAt.Sub(startedAt).Milliseconds(),
			"stateMatching":  stateReadyAt.Sub(planReadyAt).Milliseconds(),
			"candidatePrep":  downloadReadyAt.Sub(stateReadyAt).Milliseconds(),
			"total":          time.Since(startedAt).Milliseconds(),
		},
	}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		fmt.Printf("失败：无法编码 evidence manifest：%v\n", err)
		return 1
	}
	manifestPath := filepath.Join(resolvedOutputDir, "manifest.json")
	if err := writeFileAtomic(manifestPath, append(encoded, '\n'), 0o755, 0o644); err != nil {
		fmt.Printf("失败：无法写入 evidence manifest：%v\n", err)
		return 1
	}

	fmt.Printf("Supplied-source preflight passed: %d source unit(s), %d planned story/stories, %d topTitle categor(ies).\n",
		summary.SourceUnits, summary.PlannedStories, summary.TopTitleCategories)
	fmt.Printf("Top navigation: %.0f/%dpx across %d item(s) (%.1f%%, %s; comfort target %.0f%%).\n",
		navigation.Top.RequiredWidth, navigation.Top.AvailableWidth, navigation.Top.ItemCount,
		navigation.Top.FillRatio*100, navigation.Top.Density, navigation.Top.ComfortFillRatio*100)
	if navigation.Top.Density == "dense" {
		fmt.Println("Warning: top navigation is dense; shorten labels semantically first, then merge only adjacent related categories if needed.")
	}
	fmt.Printf("RSS state: %d matched, %d unmatched. Candidates: %d reference(s), %d reviewable, %d filtered, %d duplicate, %d failed, %d cache hit(s).\n",
		summary.StateMatches, summary.UnmatchedSources, summary.CandidateReferences,
		summary.ReviewableCandidateReferences, summary.FilteredCandidateReferences,
		summary.DuplicateCandidateReferences, summary.FailedCandidateReferences, summary.CacheHits)
	fmt.Printf("Evidence manifest: %s\n", manifestPath)
	return 0
}

func loadSuppliedEvidenceInput(path string) (suppliedEvidenceInput, string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return suppliedEvidenceInput{}, "", err
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		return suppliedEvidenceInput{}, "", err
	}
	var input suppliedEvidenceInput
	if err := json.Unmarshal(data, &input); err != nil {
		return suppliedEvidenceInput{}, "", fmt.Errorf("JSON 无效: %w", err)
	}
	for index := range input.Sources {
		input.Sources[index].Hash = strings.ToLower(strings.TrimSpace(input.Sources[index].Hash))
		input.Sources[index].SourceID = strings.TrimSpace(input.Sources[index].SourceID)
		input.Sources[index].Title = strings.TrimSpace(input.Sources[index].Title)
		input.Sources[index].Link = strings.TrimSpace(input.Sources[index].Link)
		input.Sources[index].LocalPath = strings.TrimSpace(input.Sources[index].LocalPath)
		if input.Sources[index].LocalPath != "" && !filepath.IsAbs(input.Sources[index].LocalPath) {
			input.Sources[index].LocalPath = filepath.Join(filepath.Dir(absolute), input.Sources[index].LocalPath)
		}
	}
	for index := range input.StoryPlan {
		input.StoryPlan[index].ID = strings.TrimSpace(input.StoryPlan[index].ID)
		input.StoryPlan[index].TopTitle = strings.TrimSpace(input.StoryPlan[index].TopTitle)
		input.StoryPlan[index].BottomTitle = strings.TrimSpace(input.StoryPlan[index].BottomTitle)
	}
	return input, absolute, nil
}

func validateSuppliedEvidenceInput(input suppliedEvidenceInput, layout navigationLayoutConfig) []string {
	var errors []string
	if len(input.Sources) == 0 {
		errors = append(errors, "sources: must contain at least one source unit")
	}
	for index, source := range input.Sources {
		if source.Hash != "" && !hexHashPattern.MatchString(source.Hash) {
			errors = append(errors, fmt.Sprintf("sources[%d].hash: must be a 64-character hexadecimal RSS state key", index))
		}
		if strings.TrimSpace(source.Hash) == "" && strings.TrimSpace(source.Link) == "" && strings.TrimSpace(source.LocalPath) == "" && strings.TrimSpace(source.Content) == "" {
			errors = append(errors, fmt.Sprintf("sources[%d]: needs hash, link, localPath, or content", index))
		}
	}
	if len(input.StoryPlan) == 0 {
		errors = append(errors, "storyPlan: must be created before evidence work")
		return errors
	}

	seenIDs := make(map[string]bool)
	usedSources := make(map[int]bool)
	closedTopTitles := make(map[string]bool)
	previousTopTitle := ""
	stories := make([]DataJSONStory, 0, len(input.StoryPlan))
	for index, story := range input.StoryPlan {
		storyPath := fmt.Sprintf("storyPlan[%d]", index)
		storyID := strings.TrimSpace(story.ID)
		if !validIdentifier.MatchString(storyID) {
			errors = append(errors, fmt.Sprintf("%s.id: must match %s", storyPath, validIdentifier.String()))
		} else if seenIDs[storyID] {
			errors = append(errors, fmt.Sprintf("%s.id: duplicate id %q", storyPath, storyID))
		}
		seenIDs[storyID] = true
		if len(story.SourceIndexes) == 0 {
			errors = append(errors, fmt.Sprintf("%s.sourceIndexes: must contain at least one 1-based source index", storyPath))
		}
		for _, sourceIndex := range story.SourceIndexes {
			if sourceIndex < 1 || sourceIndex > len(input.Sources) {
				errors = append(errors, fmt.Sprintf("%s.sourceIndexes: %d is outside 1..%d", storyPath, sourceIndex, len(input.Sources)))
				continue
			}
			usedSources[sourceIndex] = true
		}
		topTitle := strings.TrimSpace(story.TopTitle)
		bottomTitle := strings.TrimSpace(story.BottomTitle)
		if topTitle == "" {
			errors = append(errors, fmt.Sprintf("%s.topTitle: must not be empty", storyPath))
		}
		if bottomTitle == "" {
			errors = append(errors, fmt.Sprintf("%s.bottomTitle: must not be empty", storyPath))
		}
		if topTitle != "" {
			if topTitle != previousTopTitle {
				if closedTopTitles[topTitle] {
					errors = append(errors, fmt.Sprintf("%s.topTitle: category %q appears in multiple non-adjacent segments", storyPath, topTitle))
				}
				if previousTopTitle != "" {
					closedTopTitles[previousTopTitle] = true
				}
				previousTopTitle = topTitle
			}
		}
		stories = append(stories, DataJSONStory{TopTitle: topTitle, BottomTitle: bottomTitle})
	}
	for sourceIndex := 1; sourceIndex <= len(input.Sources); sourceIndex++ {
		if !usedSources[sourceIndex] {
			errors = append(errors, fmt.Sprintf("sources[%d]: is not assigned to any storyPlan entry", sourceIndex-1))
		}
	}
	if len(stories) > 0 {
		navigation := suppliedNavigationStatsFor(input.StoryPlan, layout)
		if navigation.Top.RequiredWidth > float64(layout.VideoWidth) {
			errors = append(errors, fmt.Sprintf("storyPlan top navigation requires %.0fpx but only %dpx is available", navigation.Top.RequiredWidth, layout.VideoWidth))
		}
		if navigation.Bottom.RequiredWidth > float64(layout.VideoWidth) {
			errors = append(errors, fmt.Sprintf("storyPlan bottom navigation requires %.0fpx but only %dpx is available", navigation.Bottom.RequiredWidth, layout.VideoWidth))
		}
	}
	return errors
}

func suppliedNavigationStatsFor(plan []suppliedStoryPlan, layout navigationLayoutConfig) suppliedNavigationStats {
	stories := make([]DataJSONStory, 0, len(plan))
	bottomLabels := []string{"Intro"}
	for _, story := range plan {
		stories = append(stories, DataJSONStory{
			TopTitle:    strings.TrimSpace(story.TopTitle),
			BottomTitle: strings.TrimSpace(story.BottomTitle),
		})
		bottomLabels = append(bottomLabels, strings.TrimSpace(story.BottomTitle))
	}
	bottomLabels = append(bottomLabels, "再见")
	topLabels := topNavigationLabels(stories)
	topRequired := layout.requiredWidth(topLabels)
	bottomRequired := layout.requiredBottomWidth(bottomLabels)
	topFill := topRequired / float64(layout.VideoWidth)
	bottomFill := bottomRequired / float64(layout.VideoWidth)
	density := "comfortable"
	if topFill > 1 {
		density = "overflow"
	} else if topFill > layout.TopComfortFillRatio {
		density = "dense"
	}
	return suppliedNavigationStats{
		Top: suppliedNavigationRow{
			Labels:           topLabels,
			ItemCount:        len(topLabels),
			AvailableWidth:   layout.VideoWidth,
			RequiredWidth:    topRequired,
			FillRatio:        math.Round(topFill*10000) / 10000,
			ComfortFillRatio: layout.TopComfortFillRatio,
			Density:          density,
		},
		Bottom: suppliedNavigationRow{
			Labels:         bottomLabels,
			ItemCount:      len(bottomLabels),
			AvailableWidth: layout.VideoWidth,
			RequiredWidth:  bottomRequired,
			FillRatio:      math.Round(bottomFill*10000) / 10000,
		},
	}
}

func buildSuppliedSourceResults(sources []suppliedSourceUnit, state RSSState) []suppliedSourceResult {
	results := make([]suppliedSourceResult, len(sources))
	for index, source := range sources {
		result := suppliedSourceResult{Index: index + 1, Input: source, MatchedBy: "none", Candidates: []suppliedEvidenceCandidate{}}
		hash, item, matchedBy := matchSuppliedSource(source, state)
		if matchedBy == "none" {
			result.ExternalLinks = unmatchedSuppliedExternalLinks(source)
			candidateIndex := 1
			seenCandidateURLs := make(map[string]bool)
			if isSupportedSuppliedLocalImage(source.LocalPath) {
				result.Candidates = append(result.Candidates, suppliedEvidenceCandidate{
					Index: candidateIndex, Origin: "localInput", Path: source.LocalPath,
				})
				candidateIndex++
			}
			if link := firstSuppliedHTTPURL(source.Link); imageURLPattern.MatchString(link) {
				result.Candidates = append(result.Candidates, suppliedEvidenceCandidate{
					Index: candidateIndex, Origin: "directImageInput", URL: link,
				})
				seenCandidateURLs[link] = true
				candidateIndex++
			}
			for _, imageURL := range extractRemoteImageURLs(source.Content) {
				if seenCandidateURLs[imageURL] {
					continue
				}
				seenCandidateURLs[imageURL] = true
				result.Candidates = append(result.Candidates, suppliedEvidenceCandidate{
					Index: candidateIndex, Origin: "inputContent", URL: imageURL,
				})
				candidateIndex++
			}
			results[index] = result
			continue
		}
		result.MatchedBy = matchedBy
		result.StateHash = hash
		result.StateItem = &item
		result.ExternalLinks = extractSuppliedExternalLinks(item.Description, item.Link)
		for candidateIndex, imageURL := range extractRemoteImageURLs(item.Description) {
			result.Candidates = append(result.Candidates, suppliedEvidenceCandidate{Index: candidateIndex + 1, Origin: "rssState", URL: imageURL})
		}
		results[index] = result
	}
	return results
}

func matchSuppliedSource(source suppliedSourceUnit, state RSSState) (string, StateItem, string) {
	hash := strings.ToLower(strings.TrimSpace(source.Hash))
	if item, exists := state.Items[hash]; exists {
		return hash, item, "hash"
	}
	keys := make([]string, 0, len(state.Items))
	for key := range state.Items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	wantedLink := normalizeSuppliedLink(source.Link)
	if wantedLink != "" {
		for _, key := range keys {
			if normalizeSuppliedLink(state.Items[key].Link) == wantedLink {
				return key, state.Items[key], "link"
			}
		}
	}
	wantedTopic := suppliedLinuxDoTopicID(source.Link)
	if wantedTopic != "" {
		for _, key := range keys {
			if suppliedLinuxDoTopicID(state.Items[key].Link) == wantedTopic {
				return key, state.Items[key], "topicId"
			}
		}
	}
	return "", StateItem{}, "none"
}

func firstSuppliedHTTPURL(value string) string {
	match := suppliedHTTPURLPattern.FindString(html.UnescapeString(value))
	return strings.TrimRight(match, `.,;:!?。，；：！？)'"）】`)
}

func normalizeSuppliedLink(value string) string {
	raw := firstSuppliedHTTPURL(value)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if port != "" && !((parsed.Scheme == "https" && port == "443") || (parsed.Scheme == "http" && port == "80")) {
		host += ":" + port
	}
	path := strings.TrimRight(parsed.EscapedPath(), "/")
	if path == "" {
		path = "/"
	}
	return host + path
}

func suppliedLinuxDoTopicID(value string) string {
	match := linuxDoTopicPattern.FindStringSubmatch(firstSuppliedHTTPURL(value))
	if len(match) != 2 {
		return ""
	}
	return match[1]
}

func extractSuppliedExternalLinks(description, sourceLink string) []string {
	seen := make(map[string]bool)
	sourceKey := normalizeSuppliedLink(sourceLink)
	var links []string
	for _, match := range suppliedHrefPattern.FindAllStringSubmatch(description, -1) {
		link := firstSuppliedHTTPURL(match[1])
		parsed, err := url.Parse(link)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			continue
		}
		key := normalizeSuppliedLink(link)
		if key == "" || key == sourceKey || seen[key] || imageURLPattern.MatchString(link) {
			continue
		}
		seen[key] = true
		links = append(links, link)
	}
	return links
}

func unmatchedSuppliedExternalLinks(source suppliedSourceUnit) []string {
	seen := make(map[string]bool)
	var links []string
	appendLink := func(link string) {
		key := normalizeSuppliedLink(link)
		if key == "" || seen[key] || imageURLPattern.MatchString(link) {
			return
		}
		seen[key] = true
		links = append(links, link)
	}
	if link := firstSuppliedHTTPURL(source.Link); link != "" {
		appendLink(link)
	}
	for _, link := range extractSuppliedExternalLinks(source.Content, "") {
		appendLink(link)
	}
	return links
}

func isSupportedSuppliedLocalImage(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".avif":
		return true
	default:
		return false
	}
}

func prepareSuppliedCandidateDownloads(sources []suppliedSourceResult, outputDir string, client *http.Client, concurrency int) (int, error) {
	candidatesDir := filepath.Join(outputDir, "candidates")
	if err := os.MkdirAll(candidatesDir, 0o755); err != nil {
		return 0, err
	}
	var jobs []suppliedCandidateJob
	seenURLs := make(map[string]bool)
	for _, source := range sources {
		referer := source.Input.Link
		if source.StateItem != nil && source.StateItem.Link != "" {
			referer = source.StateItem.Link
		}
		for _, candidate := range source.Candidates {
			if candidate.URL == "" {
				continue
			}
			if seenURLs[candidate.URL] {
				continue
			}
			seenURLs[candidate.URL] = true
			jobs = append(jobs, suppliedCandidateJob{URL: candidate.URL, Referer: firstSuppliedHTTPURL(referer)})
		}
	}
	downloads := downloadSuppliedCandidateJobs(jobs, candidatesDir, client, concurrency)
	byURL := make(map[string]suppliedCandidateDownload, len(jobs))
	for index, job := range jobs {
		byURL[job.URL] = downloads[index]
	}

	type seenCandidate struct {
		key        string
		reviewable bool
	}
	seenContent := make(map[string]seenCandidate)
	for sourceIndex := range sources {
		reviewable := 0
		for candidateIndex := range sources[sourceIndex].Candidates {
			candidate := &sources[sourceIndex].Candidates[candidateIndex]
			download := byURL[candidate.URL]
			if candidate.Origin == "localInput" {
				download = inspectSuppliedLocalCandidate(candidate.Path)
			}
			candidate.Path = download.Path
			candidate.Width = download.Width
			candidate.Height = download.Height
			candidate.Bytes = download.Bytes
			candidate.SHA256 = download.SHA256
			candidate.CacheHit = download.CacheHit
			candidate.DownloadMs = download.DownloadMs
			key := fmt.Sprintf("source-%02d-candidate-%02d", sourceIndex+1, candidateIndex+1)
			if download.Err != nil {
				candidate.Status = "failed"
				candidate.Reason = download.Err.Error()
				continue
			}
			if previous, exists := seenContent[download.SHA256]; exists {
				candidate.Status = "duplicate"
				candidate.Reviewable = previous.reviewable
				candidate.DuplicateOf = previous.key
				candidate.Reason = "same downloaded content as " + previous.key
				if candidate.Reviewable {
					reviewable++
				}
				continue
			}
			explicitImage := candidate.Origin == "localInput" || candidate.Origin == "directImageInput"
			if !explicitImage && isLikelyDecorativeCandidateImage(download.Width, download.Height) {
				candidate.Status = "filtered"
				candidate.Reason = fmt.Sprintf("likely avatar, logo, or small icon (%dx%d)", download.Width, download.Height)
				seenContent[download.SHA256] = seenCandidate{key: key, reviewable: false}
				continue
			}
			candidate.Status = "ready"
			candidate.Reviewable = true
			seenContent[download.SHA256] = seenCandidate{key: key, reviewable: true}
			reviewable++
		}
		sources[sourceIndex].NoReviewableStateCandidate = reviewable == 0
	}
	return len(jobs), nil
}

func inspectSuppliedLocalCandidate(path string) suppliedCandidateDownload {
	startedAt := time.Now()
	absolute, err := filepath.Abs(path)
	if err != nil {
		return suppliedCandidateDownload{DownloadMs: time.Since(startedAt).Milliseconds(), Err: err}
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		return suppliedCandidateDownload{DownloadMs: time.Since(startedAt).Milliseconds(), Err: err}
	}
	width, height := decodeOverlayImageDimensions(data)
	if width <= 0 || height <= 0 {
		return suppliedCandidateDownload{DownloadMs: time.Since(startedAt).Milliseconds(), Err: fmt.Errorf("cannot decode local image dimensions")}
	}
	contentHash := sha256.Sum256(data)
	return suppliedCandidateDownload{
		Path:       absolute,
		Width:      width,
		Height:     height,
		Bytes:      len(data),
		SHA256:     hex.EncodeToString(contentHash[:]),
		DownloadMs: time.Since(startedAt).Milliseconds(),
	}
}

func downloadSuppliedCandidateJobs(jobs []suppliedCandidateJob, candidatesDir string, client *http.Client, concurrency int) []suppliedCandidateDownload {
	results := make([]suppliedCandidateDownload, len(jobs))
	indexes := make(chan int)
	var workers sync.WaitGroup
	workerCount := min(concurrency, len(jobs))
	for worker := 0; worker < workerCount; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range indexes {
				results[index] = downloadSuppliedCandidate(jobs[index], candidatesDir, client)
			}
		}()
	}
	for index := range jobs {
		indexes <- index
	}
	close(indexes)
	workers.Wait()
	return results
}

func downloadSuppliedCandidate(job suppliedCandidateJob, candidatesDir string, client *http.Client) suppliedCandidateDownload {
	startedAt := time.Now()
	urlHash := sha256.Sum256([]byte(job.URL))
	base := hex.EncodeToString(urlHash[:])[:20]
	extension := supportedOverlayImageExtensionFromURL(job.URL)
	cachePath := filepath.Join(candidatesDir, base+extension)
	if data, err := os.ReadFile(cachePath); err == nil {
		width, height := decodeOverlayImageDimensions(data)
		if width > 0 && height > 0 {
			contentHash := sha256.Sum256(data)
			return suppliedCandidateDownload{
				Path:       cachePath,
				Width:      width,
				Height:     height,
				Bytes:      len(data),
				SHA256:     hex.EncodeToString(contentHash[:]),
				CacheHit:   true,
				DownloadMs: time.Since(startedAt).Milliseconds(),
			}
		}
	}
	data, downloadedExtension, err := fetchOverlayImage(client, job.URL, job.Referer)
	if err != nil {
		return suppliedCandidateDownload{DownloadMs: time.Since(startedAt).Milliseconds(), Err: err}
	}
	width, height := decodeOverlayImageDimensions(data)
	if width <= 0 || height <= 0 {
		return suppliedCandidateDownload{DownloadMs: time.Since(startedAt).Milliseconds(), Err: fmt.Errorf("cannot decode image dimensions")}
	}
	cachePath = filepath.Join(candidatesDir, base+downloadedExtension)
	if err := writeFileAtomic(cachePath, data, 0o755, 0o644); err != nil {
		return suppliedCandidateDownload{DownloadMs: time.Since(startedAt).Milliseconds(), Err: err}
	}
	contentHash := sha256.Sum256(data)
	return suppliedCandidateDownload{
		Path:       cachePath,
		Width:      width,
		Height:     height,
		Bytes:      len(data),
		SHA256:     hex.EncodeToString(contentHash[:]),
		DownloadMs: time.Since(startedAt).Milliseconds(),
	}
}

func summarizeSuppliedEvidence(input suppliedEvidenceInput, sources []suppliedSourceResult, uniqueURLs int) suppliedEvidenceSummary {
	summary := suppliedEvidenceSummary{
		SourceUnits:         len(input.Sources),
		PlannedStories:      len(input.StoryPlan),
		UniqueCandidateURLs: uniqueURLs,
	}
	topTitles := make(map[string]bool)
	for _, story := range input.StoryPlan {
		topTitles[strings.TrimSpace(story.TopTitle)] = true
	}
	summary.TopTitleCategories = len(topTitles)
	for _, source := range sources {
		if source.MatchedBy == "none" {
			summary.UnmatchedSources++
		} else {
			summary.StateMatches++
		}
		if source.NoReviewableStateCandidate {
			summary.SourcesWithoutStateCandidates++
		}
		for _, candidate := range source.Candidates {
			summary.CandidateReferences++
			if candidate.CacheHit {
				summary.CacheHits++
			}
			switch candidate.Status {
			case "ready":
				summary.ReviewableCandidateReferences++
			case "duplicate":
				summary.DuplicateCandidateReferences++
				if candidate.Reviewable {
					summary.ReviewableCandidateReferences++
				}
			case "filtered":
				summary.FilteredCandidateReferences++
			case "failed":
				summary.FailedCandidateReferences++
			}
		}
	}
	return summary
}
