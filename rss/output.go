package main

import (
	"fmt"
	"strings"
)

func printNewsGroups(groups []NewsGroup, items []Item) {
	fmt.Printf("\n🔥 TOP %d 个个人关注 AI 主题（已合并相似内容）\n", len(groups))
	fmt.Println(strings.Repeat("─", 50))
	for i, group := range groups {
		fmt.Printf("\n%d. ⭐ %d/10  %s\n", i+1, group.Score, group.Title)
		fmt.Printf("   📝 %s\n", group.Reason)
		for j, highlight := range group.Highlights {
			idx := highlight.Index - 1
			if idx < 0 || idx >= len(items) {
				continue
			}
			fmt.Printf("   %d) %s\n", j+1, highlight.Point)
			fmt.Printf("      原文: %s\n", items[idx].Title)
			fmt.Printf("      🔗 %s\n", items[idx].Link)
			fmt.Printf("      🕐 %s\n", items[idx].PubDate)
		}
		if duplicateCount := len(group.SourceIndexes) - len(group.Highlights); duplicateCount > 0 {
			fmt.Printf("   ♻ 已合并 %d 条未提供新增信息的相似来源\n", duplicateCount)
		}
		fmt.Println("   🎬 视频 Tabs:")
		for j, tab := range group.Tabs {
			fmt.Printf("      %d) [%s] %s\n", j+1, tab.Kind, tab.Title)
			fmt.Printf("         %s\n", tab.Summary)
		}
	}
	fmt.Println(strings.Repeat("─", 50))
}

func printItems(items []Item) {
	for i, item := range items {
		fmt.Printf("%d. %s\n", i+1, item.Title)
		fmt.Printf("   🔗 %s\n", item.Link)
		fmt.Printf("   🕐 %s\n\n", item.PubDate)
	}
}
