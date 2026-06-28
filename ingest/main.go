package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// main 是程序入口，串联整条 RSS 日报生成流水线：
// 加载配置 → 抓取并去重 → 模型评分 → 聚类合并 → 编排视频 Tabs → 打印并写出 data.json。
// 任一 AI 步骤失败即中止（不产出低质兜底成片）——低质成片仍需人工返工，不如直接失败、修好 AI 后重跑。
func main() {
	os.Exit(run())
}

func run() int {
	config, err := loadConfig()
	if err != nil {
		fmt.Printf("失败：启动配置无效：%v\n", err)
		fmt.Println("   请检查项目根目录 .env、ingest/sources.jsonc 和 ingest/preferences.jsonc。")
		return 1
	}

	reportPath, err := defaultDataJSONPath()
	if err != nil {
		fmt.Printf("失败：无法确定 data.json 输出位置：%v\n", err)
		return 1
	}

	printRunOverview(config, reportPath)

	fmt.Println("[1/6] 抓取 RSS 2.0")
	fetchedItems, fetchFailures := fetchRecentItems(config.Sources, config.Lookback)
	for sourceID, fetchErr := range fetchFailures {
		fmt.Printf("   ⚠️  警告：来源 %s 抓取失败，本次保留其上一次运行状态：%v\n", sourceID, fetchErr)
	}
	if len(fetchFailures) == len(config.Sources) {
		fmt.Println("失败：所有 RSS 来源均抓取失败。")
		return 1
	}
	fmt.Printf("   完成：时间窗口内共 %d 条\n\n", len(fetchedItems))

	fmt.Println("[2/6] 加载最近一次抓取快照")
	state, err := loadRSSState(config.StatePath)
	if err != nil {
		fmt.Printf("失败：无法读取上一次 RSS 快照：%v\n", err)
		return 1
	}
	nextState := mergeRSSState(fetchedItems, state, fetchFailures)
	if len(fetchedItems) == 0 {
		if err := saveRSSState(config.StatePath, nextState); err != nil {
			fmt.Printf("失败：无法保存本次 RSS 快照：%v\n", err)
			return 1
		}
		fmt.Printf("提示：成功抓取的来源在最近 %s内没有内容，本次结束。\n", formatDuration(config.Lookback))
		return 0
	}
	// 评分对最近 24 小时窗口内的全部条目进行（不再按抓取快照预过滤）：这样昨天未入选的
	// 高价值条目今天仍能参与竞争，避免"见过但没发布"的好新闻凭空消失；新鲜度由评分阶段的稳定
	// tie-break（同分时新内容优先）保证，抓取快照仍由 rss-state.json 记录、用于来源失败保留等语义。
	items := fetchedItems

	// 先持久化本次抓取快照：后续任一 AI 阶段失败中止时，下一次重跑不必重新抓取（重付网络/Cloudflare 成本）。
	if err := saveRSSState(config.StatePath, nextState); err != nil {
		fmt.Printf("失败：无法保存本次 RSS 快照：%v\n", err)
		return 1
	}

	fmt.Printf("[3/6] AI 兴趣筛选（%s）\n", config.AI.Model)
	scored, err := analyzeWithModel(config.AI, config.Preferences, items)
	if err != nil {
		// AI 评分失败即中止：本地兜底只产出标题/通用 Tab 的低质成片，仍需人工返工，不如直接失败。
		fmt.Printf("失败：模型评分失败：%v\n", err)
		fmt.Println("   请检查 .env 的 AI_API_KEY/AI_BASE_URL/AI_MODEL 与模型服务可用性后重试 `bun run rss`。")
		return 1
	}
	if len(scored) == 0 {
		fmt.Println("提示：没有符合兴趣规则的新闻，本次结束。")
		return 0
	}
	fmt.Printf("   完成：从 %d 条内容中保留 %d 条候选\n\n", len(items), len(scored))

	fmt.Println("[4/6] 合并相似新闻")
	groups, err := groupSimilarNews(config.AI, scored, items)
	if err != nil {
		fmt.Printf("失败：AI 粗合并失败：%v\n", err)
		fmt.Println("   请检查模型服务可用性后重试 `bun run rss`。")
		return 1
	}
	fmt.Printf("   完成：粗分组为 %d 个新闻主题\n\n", len(groups))

	fmt.Println("[4.5/6] 内容感知合并相似 Story")
	groups, err = mergeStoriesWithContent(config.AI, groups, items)
	if err != nil {
		fmt.Printf("失败：内容感知合并失败：%v\n", err)
		return 1
	}
	fmt.Printf("   完成：合并为 %d 个新闻主题\n\n", len(groups))

	fmt.Println("[5/6] 生成视频 Tabs 与字幕")
	groups, err = generateStoryTabs(config.AI, groups, items)
	if err != nil {
		fmt.Printf("失败：AI Tabs 编排失败：%v\n", err)
		fmt.Println("   请检查模型服务可用性后重试 `bun run rss`。")
		return 1
	}
	fmt.Printf("   完成：%d 个新闻主题已完成视频编排\n", len(groups))

	printNewsGroups(groups, items)

	fmt.Println("\n[6/6] 生成 Remotion data.json")
	if err := generateDataJSON(reportPath, groups, items); err != nil {
		fmt.Printf("失败：data.json 生成失败：%v\n", err)
		return 1
	}
	fmt.Printf("   完成：写入 %s\n", reportPath)
	if err := saveRSSState(config.StatePath, nextState); err != nil {
		fmt.Printf("失败：data.json 已生成，但无法保存本次 RSS 快照：%v\n", err)
		return 1
	}
	fmt.Printf("   完成：本次完整 RSS 快照已保存至 %s\n", config.StatePath)
	fmt.Printf("\n全部完成：抓取 %d 条，生成 %d 个新闻主题。\n",
		len(fetchedItems), len(groups))
	return 0
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
