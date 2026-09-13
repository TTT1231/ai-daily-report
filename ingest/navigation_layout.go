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
	MaxTopCategories       int
	VideoWidth             int
	TopComfortFillRatio    float64
	MinimumItemWidth       float64
	EdgeInset              float64
	ItemGap                float64
	ASCIIWidthFactor       float64
	ItemChromeWidth        float64
	BottomWindowItems      int
	BottomInactiveFontSize float64
	BottomActiveFontSize   float64
	BottomHorizontalPad    float64
	BottomActiveExtraGap   float64
	BottomCounterWidth     float64
	Layouts                []navigationTypography
}

// asciiWidthUnit 与 config/video-layout.json 的 navigation.asciiWidthFactor 是
// 同一口径：validNavigationTitle / tabSummaryVisualUnits 等纯函数用它估宽（运行期
// 布局代码经 loadNavigationLayout 读真实配置）。TestASCIIWidthUnitMatchesConfig
// 在测试期对照配置文件防漂移——改 asciiWidthFactor 时必须同步改这里。
const asciiWidthUnit = 0.62

type navigationTypography struct {
	MinItems          int     `json:"minItems"`
	FontSize          float64 `json:"fontSize"`
	HorizontalPadding float64 `json:"horizontalPadding"`
}

type videoLayoutFile struct {
	Width      int `json:"width"`
	Navigation struct {
		MaxTopCategories       int                    `json:"maxTopCategories"`
		TopComfortFillRatio    float64                `json:"topComfortFillRatio"`
		MinimumItemWidth       float64                `json:"minimumItemWidth"`
		EdgeInset              float64                `json:"edgeInset"`
		ItemGap                float64                `json:"itemGap"`
		ASCIIWidthFactor       float64                `json:"asciiWidthFactor"`
		ItemChromeWidth        float64                `json:"itemChromeWidth"`
		BottomWindowItems      int                    `json:"bottomWindowItems"`
		BottomInactiveFontSize float64                `json:"bottomInactiveFontSize"`
		BottomActiveFontSize   float64                `json:"bottomActiveFontSize"`
		BottomHorizontalPad    float64                `json:"bottomHorizontalPadding"`
		BottomActiveExtraGap   float64                `json:"bottomActiveExtraGap"`
		BottomCounterWidth     float64                `json:"bottomCounterWidth"`
		Layouts                []navigationTypography `json:"layouts"`
	} `json:"navigation"`
}

func loadNavigationLayout() (navigationLayoutConfig, error) {
	root, err := projectRoot()
	if err != nil {
		return navigationLayoutConfig{}, err
	}
	data, err := os.ReadFile(filepath.Join(root, "config", "video-layout.json"))
	if err != nil {
		return navigationLayoutConfig{}, fmt.Errorf("读取 video-layout.json 失败: %w", err)
	}
	var file videoLayoutFile
	if err := json.Unmarshal(data, &file); err != nil {
		return navigationLayoutConfig{}, fmt.Errorf("解析 video-layout.json 失败: %w", err)
	}
	if file.Navigation.MaxTopCategories < 1 || file.Navigation.MaxTopCategories > 5 ||
		file.Width <= 0 ||
		file.Navigation.TopComfortFillRatio <= 0 ||
		file.Navigation.TopComfortFillRatio > 1 ||
		file.Navigation.MinimumItemWidth <= 0 ||
		len(file.Navigation.Layouts) == 0 {
		return navigationLayoutConfig{}, fmt.Errorf("video-layout.json 的导航尺寸配置无效")
	}
	// 底部窗口规格是渲染层的单一事实源（激活项放大字号 + 序号胶囊），缺失会让宽度估算失真。
	if file.Navigation.BottomWindowItems <= 0 ||
		file.Navigation.BottomInactiveFontSize <= 0 ||
		file.Navigation.BottomActiveFontSize <= 0 ||
		file.Navigation.BottomHorizontalPad < 0 ||
		file.Navigation.BottomActiveExtraGap < 0 ||
		file.Navigation.BottomCounterWidth < 0 {
		return navigationLayoutConfig{}, fmt.Errorf("video-layout.json 的底部窗口导航配置无效")
	}
	return navigationLayoutConfig{
		MaxTopCategories:       file.Navigation.MaxTopCategories,
		VideoWidth:             file.Width,
		TopComfortFillRatio:    file.Navigation.TopComfortFillRatio,
		MinimumItemWidth:       file.Navigation.MinimumItemWidth,
		EdgeInset:              file.Navigation.EdgeInset,
		ItemGap:                file.Navigation.ItemGap,
		ASCIIWidthFactor:       file.Navigation.ASCIIWidthFactor,
		ItemChromeWidth:        file.Navigation.ItemChromeWidth,
		BottomWindowItems:      file.Navigation.BottomWindowItems,
		BottomInactiveFontSize: file.Navigation.BottomInactiveFontSize,
		BottomActiveFontSize:   file.Navigation.BottomActiveFontSize,
		BottomHorizontalPad:    file.Navigation.BottomHorizontalPad,
		BottomActiveExtraGap:   file.Navigation.BottomActiveExtraGap,
		BottomCounterWidth:     file.Navigation.BottomCounterWidth,
		Layouts:                file.Navigation.Layouts,
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

// 底部窗口导航不使用 layouts 的响应式字号；当前项字号更大并附带序号胶囊。
// 口径必须与 src/navigation-layout.ts 的 navigationBottomItemMinimumWidth 一致。
func (layout navigationLayoutConfig) bottomItemMinimumWidth(label string, active bool) float64 {
	fontSize := layout.BottomInactiveFontSize
	activeExtras := 0.0
	if active {
		fontSize = layout.BottomActiveFontSize
		activeExtras = layout.BottomActiveExtraGap + layout.BottomCounterWidth
	}
	textWidth := layout.labelWidthUnits(label)*fontSize +
		layout.BottomHorizontalPad*2 + layout.ItemChromeWidth + activeExtras
	return math.Max(layout.MinimumItemWidth, math.Ceil(textWidth))
}

func slidingWindows(labels []string, windowItems int) [][]string {
	if windowItems <= 0 || len(labels) <= windowItems {
		return [][]string{labels}
	}
	windows := make([][]string, 0, len(labels)-windowItems+1)
	for start := 0; start+windowItems <= len(labels); start++ {
		windows = append(windows, labels[start:start+windowItems])
	}
	return windows
}

// requiredBottomWidth 取所有滑动窗口中最宽的一行。渲染时窗口内恰有一项激活，
// 这里按最坏情况把增量最大的项当作激活项，避免"估算通过但画面越界"。
func (layout navigationLayoutConfig) requiredBottomWidth(labels []string) float64 {
	width := 0.0
	for _, window := range slidingWindows(labels, layout.BottomWindowItems) {
		rowWidth := layout.EdgeInset * 2
		if len(window) > 1 {
			rowWidth += float64(len(window)-1) * layout.ItemGap
		}
		inactiveTotal := 0.0
		maxActiveDelta := 0.0
		for _, label := range window {
			inactive := layout.bottomItemMinimumWidth(label, false)
			inactiveTotal += inactive
			if delta := layout.bottomItemMinimumWidth(label, true) - inactive; delta > maxActiveDelta {
				maxActiveDelta = delta
			}
		}
		if row := rowWidth + inactiveTotal + maxActiveDelta; row > width {
			width = row
		}
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

func validateTopCategoryCount(stories []DataJSONStory, layout navigationLayoutConfig) error {
	categories := make(map[string]bool)
	for _, story := range stories {
		categories[story.TopTitle] = true
	}
	if len(categories) > layout.MaxTopCategories {
		return fmt.Errorf("正文栏目有 %d 个，最多 %d 个（不含概览和结语）；请按共同主题归类", len(categories), layout.MaxTopCategories)
	}
	return nil
}

func fitNavigationLabels(stories []DataJSONStory, layout navigationLayoutConfig) error {
	if err := validateTopCategoryCount(stories, layout); err != nil {
		return err
	}
	if err := fitBottomNavigation(stories, layout); err != nil {
		return err
	}
	fitTopNavigation(stories, layout)
	return nil
}

func fitBottomNavigation(stories []DataJSONStory, layout navigationLayoutConfig) error {
	labels := []string{"Intro"}
	for _, story := range stories {
		labels = append(labels, story.BottomTitle)
	}
	labels = append(labels, "再见")
	required := layout.requiredBottomWidth(labels)
	if required <= float64(layout.VideoWidth) {
		return nil
	}
	windowCount := layout.BottomWindowItems
	if len(labels) < windowCount {
		windowCount = len(labels)
	}
	return fmt.Errorf(
		"底部导航最宽的 %d 项窗口需要 %.0fpx，但视频宽度只有 %dpx；bottomTitle 必须在生成阶段继续做语义缩写，禁止用省略号硬截断",
		windowCount,
		required,
		layout.VideoWidth,
	)
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
