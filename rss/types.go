package main

import "encoding/xml"

type RSS struct {
	XMLName xml.Name `xml:"rss"`
	Channel Channel  `xml:"channel"`
}

type Channel struct {
	Title string `xml:"title"`
	Items []Item `xml:"item"`
}

type Item struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	PubDate     string `xml:"pubDate"`
	Description string `xml:"description"`
	Creator     string `xml:"creator"`
}

type DSRequest struct {
	Model           string      `json:"model"`
	Messages        []DSMessage `json:"messages"`
	Stream          bool        `json:"stream"`
	Thinking        *DSThinking `json:"thinking,omitempty"`
	ReasoningEffort string      `json:"reasoning_effort,omitempty"`
}

type DSMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type DSThinking struct {
	Type string `json:"type"`
}

type DSRequestOptions struct {
	Thinking        string
	ReasoningEffort string
}

type DSResponse struct {
	Choices []DSChoice `json:"choices"`
}

type DSChoice struct {
	Message DSMessage `json:"message"`
}

type ScoredItem struct {
	Index        int    `json:"index"`
	Title        string `json:"title"`
	Score        int    `json:"score"`
	Reason       string `json:"reason"`
	KeywordScore int    `json:"-"`
}

type NewsGroup struct {
	Title           string          `json:"title"`
	NavigationTitle string          `json:"navigation_title,omitempty"`
	Score           int             `json:"score"`
	Reason          string          `json:"reason"`
	SourceIndexes   []int           `json:"source_indexes"`
	Highlights      []NewsHighlight `json:"highlights"`
	Tabs            []StoryTab      `json:"tabs,omitempty"`
}

type NewsHighlight struct {
	Index int    `json:"index"`
	Point string `json:"point"`
}

type StoryTab struct {
	Title           string `json:"title"`
	Summary         string `json:"summary"`
	Subtitle        string `json:"subtitle"`
	Kind            string `json:"kind"`
	EvidenceIndexes []int  `json:"evidence_indexes"`
}

type StoryTabsResult struct {
	GroupIndex int        `json:"group_index"`
	Tabs       []StoryTab `json:"tabs"`
}
