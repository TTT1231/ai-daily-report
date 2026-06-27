package main

import (
	"fmt"
	"sort"
)

// storyMergeResult 是 LLM 对"哪些粗分组应合并成一个最终 Story"的决策。
// MergedGroups 为输入粗分组的 1 基序号列表；每个输入粗分组必须在所有结果中出现且只出现一次。
type storyMergeResult struct {
	MergedGroups    []int           `json:"merged_groups"`
	Title           string          `json:"title"`
	NavigationTitle string          `json:"navigation_title"`
	Highlights      []NewsHighlight `json:"highlights"`
}

// applyStoryMerge 把 LLM 合并决策应用到粗分组：每个结果条目声明它合并了哪些输入粗分组，
// 取其 SourceIndexes 并集；未被任何结果覆盖的粗分组各自兜底为独立 Story（不丢内容）。
// 契约：每个输入粗分组（1..len(groups)）必须在结果中出现且只出现一次，否则报错。
func applyStoryMerge(groups []NewsGroup, results []storyMergeResult, items []Item) ([]NewsGroup, error) {
	covered := make(map[int]bool, len(groups))
	var merged []NewsGroup
	for _, res := range results {
		members, err := resolveMergeMembers(res.MergedGroups, groups, covered)
		if err != nil {
			return nil, err
		}
		if len(members) == 0 {
			continue
		}
		merged = append(merged, buildMergedGroup(members, res, items))
	}
	for i, g := range groups {
		if !covered[i+1] {
			merged = append(merged, g) // 漏掉兜底：原样保留为独立 Story
		}
	}
	if len(merged) == 0 {
		return nil, fmt.Errorf("内容感知合并结果为空")
	}
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].Score > merged[j].Score })
	return merged, nil
}

// resolveMergeMembers 校验 mergedGroups 序号合法（1 基且未被覆盖），标记 covered 并返回成员粗分组。
func resolveMergeMembers(mergedGroups []int, groups []NewsGroup, covered map[int]bool) ([]NewsGroup, error) {
	var members []NewsGroup
	for _, gi := range mergedGroups {
		if gi < 1 || gi > len(groups) {
			return nil, fmt.Errorf("merged_groups 序号越界: %d", gi)
		}
		if covered[gi] {
			return nil, fmt.Errorf("输入粗分组 %d 被重复归入", gi)
		}
		covered[gi] = true
		members = append(members, groups[gi-1])
	}
	return members, nil
}

// buildMergedGroup 合并若干粗分组为一个最终 Story：SourceIndexes 取并集，Score 取最大，
// Title/NavigationTitle 用 LLM 结果，Highlights 校验序号合法后 cap maxGroupHighlights。
func buildMergedGroup(members []NewsGroup, res storyMergeResult, items []Item) NewsGroup {
	seen := make(map[int]bool)
	var sources []int
	for _, m := range members {
		for _, idx := range m.SourceIndexes {
			if !seen[idx] {
				seen[idx] = true
				sources = append(sources, idx)
			}
		}
	}
	score := 0
	reason := ""
	for _, m := range members {
		if m.Score > score {
			score = m.Score
			reason = m.Reason
		}
	}
	highlights := capHighlights(res.Highlights, sources, items, maxGroupHighlights)
	out := NewsGroup{
		Title:           res.Title,
		NavigationTitle: res.NavigationTitle,
		Score:           score,
		Reason:          reason,
		SourceIndexes:   sources,
		Highlights:      highlights,
	}
	return out
}

// capHighlights 只保留 Index 落在 sources 内的要点，去重并截断到 limit。
func capHighlights(highlights []NewsHighlight, sources []int, items []Item, limit int) []NewsHighlight {
	valid := make(map[int]bool, len(sources))
	for _, idx := range sources {
		valid[idx] = true
	}
	seen := make(map[int]bool)
	var out []NewsHighlight
	for _, h := range highlights {
		if !valid[h.Index] || seen[h.Index] {
			continue
		}
		seen[h.Index] = true
		if h.Point == "" && h.Index >= 1 && h.Index <= len(items) {
			h.Point = items[h.Index-1].Title
		}
		out = append(out, h)
		if len(out) == limit {
			break
		}
	}
	return out
}
