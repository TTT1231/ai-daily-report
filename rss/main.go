package main

import (
	"fmt"
	"strings"
	"time"
)

// main 是程序入口，串联整条 RSS 日报生成流水线：
// 加载配置 → 抓取并去重 → 模型评分 → 聚类合并 → 编排视频 Tabs → 打印并写出 data.json。
// 任一 AI 步骤失败时都会降级为本地保底逻辑，尽量保证每次运行都能产出日报。
func main() {
	config, err := loadConfig()
	if err != nil {
		fmt.Printf("失败：启动配置无效：%v\n", err)
		fmt.Println("   请检查项目根目录 .env、rss/sources.jsonc 和 rss/preferences.jsonc。")
		return
	}

	reportPath, err := defaultDataJSONPath()
	if err != nil {
		fmt.Printf("失败：无法确定 data.json 输出位置：%v\n", err)
		return
	}

	printRunOverview(config, reportPath)

	fmt.Println("[1/6] 抓取 RSS 2.0")
	fetchedItems, fetchFailures := fetchRecentItems(config.Sources, config.Lookback)
	for sourceID, fetchErr := range fetchFailures {
		fmt.Printf("   警告：来源 %s 抓取失败，本次保留其上一次运行状态：%v\n", sourceID, fetchErr)
	}
	if len(fetchFailures) == len(config.Sources) {
		fmt.Println("失败：所有 RSS 来源均抓取失败。")
		return
	}
	fmt.Printf("   完成：时间窗口内共 %d 条\n\n", len(fetchedItems))

	fmt.Println("[2/6] 对比上一次抓取快照")
	state, err := loadRSSState(config.StatePath)
	if err != nil {
		fmt.Printf("失败：无法读取上一次 RSS 快照：%v\n", err)
		return
	}
	nextState := mergeRSSState(fetchedItems, state, fetchFailures)
	if len(fetchedItems) == 0 {
		if err := saveRSSState(config.StatePath, nextState); err != nil {
			fmt.Printf("失败：无法保存本次 RSS 快照：%v\n", err)
			return
		}
		fmt.Printf("提示：成功抓取的来源在最近 %s内没有内容，本次结束。\n", formatDuration(config.Lookback))
		return
	}
	items := filterUnseenItems(fetchedItems, state)
	fmt.Printf("   完成：新增 %d 条，重复 %d 条\n\n",
		len(items), len(fetchedItems)-len(items))
	if len(items) == 0 {
		if err := saveRSSState(config.StatePath, nextState); err != nil {
			fmt.Printf("失败：无法保存本次 RSS 快照：%v\n", err)
			return
		}
		fmt.Println("提示：没有相对上一次抓取的新内容，无需生成 data.json。")
		return
	}

	fmt.Printf("[3/6] AI 兴趣筛选（%s）\n", config.AI.Model)
	scored, err := analyzeWithModel(config.AI, config.Preferences, items)
	if err != nil {
		fmt.Printf("   警告：模型评分失败，改用本地兴趣规则：%v\n", err)
		scored = applyKeywordWeights(config.Preferences, nil, items)
	}
	if len(scored) == 0 {
		if err := saveRSSState(config.StatePath, nextState); err != nil {
			fmt.Printf("失败：无法保存本次 RSS 快照：%v\n", err)
			return
		}
		fmt.Println("提示：新内容中没有符合兴趣规则的新闻，本次结束。")
		return
	}
	fmt.Printf("   完成：从 %d 条新增内容中保留 %d 条候选\n\n", len(items), len(scored))

	fmt.Println("[4/6] 合并相似新闻")
	groups, err := groupSimilarNews(config.AI, scored, items)
	if err != nil {
		fmt.Printf("   警告：AI 合并失败，改用本地分组：%v\n", err)
		groups = fallbackGroups(scored)
	}
	fmt.Printf("   完成：生成 %d 个新闻主题\n\n", len(groups))

	fmt.Println("[5/6] 生成视频 Tabs 与字幕")
	groups, err = generateStoryTabs(config.AI, groups, items)
	if err != nil {
		fmt.Printf("   警告：AI Tabs 编排失败，改用本地保底结构：%v\n", err)
		groups = withFallbackStoryTabs(groups)
	}
	fmt.Printf("   完成：%d 个新闻主题已完成视频编排\n", len(groups))

	printNewsGroups(groups, items)

	fmt.Println("\n[6/6] 生成 Remotion data.json")
	if err := generateDataJSON(reportPath, groups, items); err != nil {
		fmt.Printf("失败：data.json 生成失败：%v\n", err)
		return
	}
	fmt.Printf("   完成：写入 %s\n", reportPath)
	if err := saveRSSState(config.StatePath, nextState); err != nil {
		fmt.Printf("失败：data.json 已生成，但无法保存本次 RSS 快照：%v\n", err)
		return
	}
	fmt.Printf("   完成：本次完整 RSS 快照已保存至 %s\n", config.StatePath)
	fmt.Printf("\n全部完成：抓取 %d 条，新增 %d 条，生成 %d 个新闻主题。\n",
		len(fetchedItems), len(items), len(groups))
}

func printRunOverview(config AppConfig, reportPath string) {
	fmt.Println("AI 日报 RSS 采集器")
	fmt.Println(strings.Repeat("=", 56))
	fmt.Printf("来源：%s（RSS 2.0）\n", sourceNames(config.Sources))
	fmt.Printf("范围：最近 %s\n", formatDuration(config.Lookback))
	fmt.Printf("模型：%s\n", config.AI.Model)
	fmt.Printf("快照：%s\n", config.StatePath)
	fmt.Printf("输出：%s\n", reportPath)
	fmt.Println(strings.Repeat("=", 56))
	fmt.Println()
}

// formatDuration 把时间时长格式化为对用户友好的中文文案（整点显示“N 小时”，否则用默认字符串）。
func formatDuration(value time.Duration) string {
	if value%time.Hour == 0 {
		return fmt.Sprintf("%d 小时", int(value/time.Hour))
	}
	return value.String()
}
