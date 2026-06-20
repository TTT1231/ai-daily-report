package main

import (
	"fmt"
	"strings"
)

// printNewsGroups 把聚类后的 Story 与要点、来源、视频 Tabs 以可读格式打印到终端，用于人工确认。
func printNewsGroups(groups []NewsGroup, items []Item) {
	fmt.Printf("\n结果预览：%d 个新闻主题\n", len(groups))
	fmt.Println(strings.Repeat("─", 50))
	for i, group := range groups {
		fmt.Printf("\n%d. [%d/10] %s\n", i+1, group.Score, group.Title)
		fmt.Printf("   入选原因：%s\n", group.Reason)
		for j, highlight := range group.Highlights {
			idx := highlight.Index - 1
			if idx < 0 || idx >= len(items) {
				continue
			}
			fmt.Printf("   %d) %s\n", j+1, highlight.Point)
			fmt.Printf("      原文: %s\n", items[idx].Title)
			fmt.Printf("      来源: %s\n", items[idx].SourceName)
			fmt.Printf("      链接: %s\n", items[idx].Link)
			fmt.Printf("      时间: %s\n", items[idx].PubDate)
		}
		if duplicateCount := len(group.SourceIndexes) - len(group.Highlights); duplicateCount > 0 {
			fmt.Printf("   已合并 %d 条未提供新增信息的相似来源\n", duplicateCount)
		}
		fmt.Println("   视频 Tabs:")
		for j, tab := range group.Tabs {
			fmt.Printf("      %d) [%s] %s\n", j+1, tab.Kind, tab.Title)
			fmt.Printf("         %s\n", tab.Summary)
		}
	}
	fmt.Println(strings.Repeat("─", 50))
}
