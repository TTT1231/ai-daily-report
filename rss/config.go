package main

import "time"

const (
	rssBase                 = "https://linux.do/c/news/34.rss"
	timeLayout              = time.RFC1123
	maxPages                = 2
	pageDelay               = 10 * time.Second
	dsBaseURL               = "https://api.deepseek.com"
	dsModel                 = "deepseek-v4-flash"
	maxCandidates           = 30
	maxGroups               = 15
	maxGroupHighlights      = 6
	storyTabBatchSize       = 4
	maxStoryTabSources      = 4
	minStoryTabs            = 2
	maxStoryTabs            = 6
	minTabSummaryRunes      = 20
	minSceneSubtitleRunes   = 28
	maxSceneSubtitleRunes   = 96
	maxSourceTextRunes      = 5000
	minNavigationTitleRunes = 3
	maxTopTitleRunes        = 5
	maxBottomTitleRunes     = 5
	maxContentTitleRunes    = 42
	minInterestingScore     = 7
)
