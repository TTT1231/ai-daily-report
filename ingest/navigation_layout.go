package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

type navigationLayoutConfig struct {
	VideoWidth       int
	MinimumItemWidth float64
	EdgeInset        float64
	ItemGap          float64
	ASCIIWidthFactor float64
	ItemChromeWidth  float64
	Layouts          []navigationTypography
}

type navigationTypography struct {
	MinItems          int     `json:"minItems"`
	FontSize          float64 `json:"fontSize"`
	HorizontalPadding float64 `json:"horizontalPadding"`
}

type videoLayoutFile struct {
	Width      int `json:"width"`
	Navigation struct {
		MinimumItemWidth float64                `json:"minimumItemWidth"`
		EdgeInset        float64                `json:"edgeInset"`
		ItemGap          float64                `json:"itemGap"`
		ASCIIWidthFactor float64                `json:"asciiWidthFactor"`
		ItemChromeWidth  float64                `json:"itemChromeWidth"`
		Layouts          []navigationTypography `json:"layouts"`
	} `json:"navigation"`
}

func loadNavigationLayout() (navigationLayoutConfig, error) {
	root, err := projectRoot()
	if err != nil {
		return navigationLayoutConfig{}, err
	}
	data, err := os.ReadFile(filepath.Join(root, "video-layout.json"))
	if err != nil {
		return navigationLayoutConfig{}, fmt.Errorf("读取 video-layout.json 失败: %w", err)
	}
	var file videoLayoutFile
	if err := json.Unmarshal(data, &file); err != nil {
		return navigationLayoutConfig{}, fmt.Errorf("解析 video-layout.json 失败: %w", err)
	}
	if file.Width <= 0 || file.Navigation.MinimumItemWidth <= 0 || len(file.Navigation.Layouts) == 0 {
		return navigationLayoutConfig{}, fmt.Errorf("video-layout.json 的导航尺寸配置无效")
	}
	return navigationLayoutConfig{
		VideoWidth:       file.Width,
		MinimumItemWidth: file.Navigation.MinimumItemWidth,
		EdgeInset:        file.Navigation.EdgeInset,
		ItemGap:          file.Navigation.ItemGap,
		ASCIIWidthFactor: file.Navigation.ASCIIWidthFactor,
		ItemChromeWidth:  file.Navigation.ItemChromeWidth,
		Layouts:          file.Navigation.Layouts,
	}, nil
}

func (layout navigationLayoutConfig) typography(itemCount int) navigationTypography {
	for _, option := range layout.Layouts {
		if itemCount >= option.MinItems {
			return option
		}
	}
	return layout.Layouts[len(layout.Layouts)-1]
}

func (layout navigationLayoutConfig) labelWidthUnits(label string) float64 {
	width := 0.0
	for _, r := range label {
		if r <= 0xff {
			width += layout.ASCIIWidthFactor
		} else {
			width++
		}
	}
	return width
}

func (layout navigationLayoutConfig) minimumWidth(label string, itemCount int) float64 {
	typography := layout.typography(itemCount)
	textWidth := layout.labelWidthUnits(label)*typography.FontSize +
		typography.HorizontalPadding*2 + layout.ItemChromeWidth
	return math.Max(layout.MinimumItemWidth, math.Ceil(textWidth))
}

func (layout navigationLayoutConfig) requiredWidth(labels []string) float64 {
	width := layout.EdgeInset * 2
	if len(labels) > 1 {
		width += float64(len(labels)-1) * layout.ItemGap
	}
	for _, label := range labels {
		width += layout.minimumWidth(label, len(labels))
	}
	return width
}

func (layout navigationLayoutConfig) comfortableItemCapacity() int {
	usable := float64(layout.VideoWidth) - layout.EdgeInset*2 + layout.ItemGap
	return max(1, int(math.Floor(usable/(layout.MinimumItemWidth+layout.ItemGap))))
}

func (layout navigationLayoutConfig) storyCapacity() int {
	return max(1, layout.comfortableItemCapacity()-2)
}

func (layout navigationLayoutConfig) truncateLabel(label string, itemCount int, maxPixels float64) string {
	label = strings.TrimSpace(label)
	if layout.minimumWidth(label, itemCount) <= maxPixels {
		return label
	}
	runes := []rune(label)
	for keep := len(runes) - 1; keep >= 1; keep-- {
		candidate := strings.TrimSpace(string(runes[:keep])) + "…"
		if layout.minimumWidth(candidate, itemCount) <= maxPixels {
			return candidate
		}
	}
	return string(runes[:1])
}

func maxStoryGroupsForNavigation() int {
	layout, err := loadNavigationLayout()
	if err != nil {
		return maxGroups
	}
	return min(maxGroups, layout.storyCapacity())
}

func fitNavigationLabels(stories []DataJSONStory, layout navigationLayoutConfig) {
	fitBottomNavigation(stories, layout)
	fitTopNavigation(stories, layout)
}

func fitBottomNavigation(stories []DataJSONStory, layout navigationLayoutConfig) {
	for {
		labels := []string{"Intro"}
		for _, story := range stories {
			labels = append(labels, story.BottomTitle)
		}
		labels = append(labels, "再见")
		if layout.requiredWidth(labels) <= float64(layout.VideoWidth) {
			return
		}

		widestIndex := -1
		widestWidth := 0.0
		for index, story := range stories {
			width := layout.minimumWidth(story.BottomTitle, len(labels))
			if len([]rune(story.BottomTitle)) > 1 && width > widestWidth {
				widestIndex = index
				widestWidth = width
			}
		}
		if widestIndex < 0 {
			return
		}
		targetWidth := widestWidth - layout.typography(len(labels)).FontSize
		stories[widestIndex].BottomTitle = layout.truncateLabel(
			stories[widestIndex].BottomTitle,
			len(labels),
			targetWidth,
		)
	}
}

func fitTopNavigation(stories []DataJSONStory, layout navigationLayoutConfig) {
	for {
		labels := topNavigationLabels(stories)
		if layout.requiredWidth(labels) <= float64(layout.VideoWidth) {
			return
		}

		widest := ""
		widestWidth := 0.0
		for _, label := range labels {
			if label == "Intro" || label == "结语" {
				continue
			}
			width := layout.minimumWidth(label, len(labels))
			if len([]rune(label)) > 1 && width > widestWidth {
				widest = label
				widestWidth = width
			}
		}
		if widest == "" {
			return
		}
		targetWidth := widestWidth - layout.typography(len(labels)).FontSize
		shortened := layout.truncateLabel(widest, len(labels), targetWidth)
		for index := range stories {
			if stories[index].TopTitle == widest {
				stories[index].TopTitle = shortened
			}
		}
	}
}

func topNavigationLabels(stories []DataJSONStory) []string {
	labels := []string{"Intro"}
	previous := "Intro"
	for _, story := range stories {
		if story.TopTitle != previous {
			labels = append(labels, story.TopTitle)
			previous = story.TopTitle
		}
	}
	if previous != "结语" {
		labels = append(labels, "结语")
	}
	return labels
}
