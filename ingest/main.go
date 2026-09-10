package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// main 是程序入口。四个子命令对应四种职责：
//
//	fetch     — 只抓取 RSS + 去重 + 写 rss-state.json（候选池），停下。供 `bun run rss`。
//	run-picks — 读 rss-state.json + picks.json，跳过评分/聚类/合并，每条 picked 独立成 Story，
//	            跑 Tabs(识图) → data.json。供 `bun run video`（人工路径）。
//	run-auto  — 等价原 run()：抓取 → 评分 → 聚类 → 合并 → Tabs(识图) → data.json。供 `bun run video:auto-generate`。
//	prepare-supplied-evidence — 校验 supplied-source 的 Story/导航计划，批量匹配 state 并准备候选图。
//
// 任一 AI 步骤失败即中止（不产出低质兜底成片）——低质成片仍需人工返工，不如直接失败、修好 AI 后重跑。
func main() {
	cmd := "run-auto"
	if len(os.Args) >= 2 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "fetch":
		os.Exit(runFetch())
	case "run-picks":
		os.Exit(runPicks())
	case "run-auto":
		os.Exit(runAuto())
	case "prepare-supplied-evidence":
		os.Exit(runPrepareSuppliedEvidence(os.Args[2:]))
	default:
		fmt.Println("用法: linuxdo-rss [fetch|run-picks|run-auto|prepare-supplied-evidence]")
		fmt.Println("  fetch     抓取 RSS 并写 rss-state.json（候选池），停下。")
		fmt.Println("  run-picks 读 rss-state.json + picks.json，人工 pick 路径生成 data.json。")
		fmt.Println("  run-auto  全自动路径（默认）：抓取→评分→识图→data.json。")
		fmt.Println("  prepare-supplied-evidence  supplied-source 预检与 RSS state 候选图批量准备。")
		os.Exit(2)
	}
}

// runFetch 对应 `bun run rss`：抓取 + 去重 + 写 rss-state.json，然后停下。
// 这是人工介入的窗口：跑完后可 `bun run rss:pick` 挑选，再 `bun run video` 生成。
func runFetch() int {
	config, err := loadConfig()
	if err != nil {
		fmt.Printf("失败：启动配置无效：%v\n", err)
		fmt.Println("   请检查项目根目录 .env、ingest/sources.jsonc 和 ingest/preferences.jsonc。")
		return 1
	}
	previousState, err := loadRSSState(config.StatePath)
	if err != nil {
		fmt.Printf("失败：无法读取上次 RSS 快照，不能安全去重：%v\n", err)
		fmt.Println("   请修复或移走 ingest/rss-state.json 后重试；移走后会从本次抓取重新建立历史。")
		return 1
	}
	// picks.json 是旧版状态没有 Picked 字段时的迁移来源，也覆盖“已保存选择但 video
	// 尚未成功”的中断场景：只有用户亲手勾选的 hash 才进入跨次去重历史。
	picksPath, err := defaultPicksPath()
	if err != nil {
		fmt.Printf("失败：无法确定 picks.json 位置：%v\n", err)
		return 1
	}
	previousPicks, err := loadPicks(picksPath)
	if err != nil {
		fmt.Printf("失败：读取 picks.json 失败，不能安全恢复人工选择历史：%v\n", err)
		return 1
	}
	rememberPickedHashes(&previousState, previousPicks)

	printRunOverview(config, config.StatePath)

	fmt.Println("[1/2] 抓取 RSS 2.0")
	fetchedItems, fetchFailures := fetchRecentItems(config.Sources, config.Lookback)
	for sourceID, fetchErr := range fetchFailures {
		fmt.Printf("   ⚠️  警告：来源 %s 抓取失败：%v\n", sourceID, fetchErr)
	}
	if len(fetchFailures) == len(config.Sources) {
		fmt.Println("失败：所有 RSS 来源均抓取失败。")
		return 1
	}
	candidateItems := filterUnpickedItems(fetchedItems, previousState)
	duplicateCount := len(fetchedItems) - len(candidateItems)
	fmt.Printf("   完成：时间窗口内共 %d 条，可选候选 %d 条", len(fetchedItems), len(candidateItems))
	if duplicateCount > 0 {
		fmt.Printf("，跳过已人工挑选 %d 条", duplicateCount)
	}
	fmt.Print("\n\n")

	fmt.Println("[2/2] 保存抓取快照")
	nextState := snapshotRSSState(candidateItems)
	mergePickedHistory(&nextState, previousState)
	if err := saveRSSState(config.StatePath, nextState); err != nil {
		fmt.Printf("失败：无法保存本次 RSS 快照：%v\n", err)
		return 1
	}
	fmt.Printf("   完成：写入 %s\n", config.StatePath)
	if len(fetchedItems) == 0 {
		fmt.Printf("\n提示：成功抓取的来源在最近 %s内没有内容。\n", formatDuration(config.Lookback))
	} else if len(candidateItems) == 0 {
		fmt.Printf("\n提示：最近 %s内抓到的 %d 条内容均已被你手动挑选过，本次没有可选候选。\n",
			formatDuration(config.Lookback), len(fetchedItems))
	} else {
		fmt.Printf("\n全部完成：保留 %d 条候选，跳过 %d 条已人工挑选内容。\n", len(candidateItems), duplicateCount)
		fmt.Println("下一步：bun run rss:pick（人工挑选）→ bun run video（生成视频）")
	}
	return 0
}

// runPicks 对应 `bun run video`（人工路径）：读 picks.json，每条 picked 独立成 Story，
// 跳过评分/聚类/合并，直接跑 Tabs(识图) → data.json。
func runPicks() int {
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

	picksPath, err := defaultPicksPath()
	if err != nil {
		fmt.Printf("失败：无法确定 picks.json 位置：%v\n", err)
		return 1
	}

	picks, err := loadPicks(picksPath)
	if err != nil {
		fmt.Printf("失败：读取 picks.json 失败：%v\n", err)
		return 1
	}
	if len(picks) == 0 {
		fmt.Println("失败：picks.json 为空或不存在。")
		fmt.Println("   请先跑：bun run rss（抓取）→ bun run rss:pick（人工挑选），再跑 bun run video。")
		return 1
	}

	fmt.Println("AI 日报 RSS 采集器（人工 pick 路径）")
	fmt.Println(strings.Repeat("=", 56))
	fmt.Printf("Picks：%s（%d 条）\n", picksPath, len(picks))
	fmt.Printf("快照：%s\n", config.StatePath)
	fmt.Printf("输出：%s\n", reportPath)
	fmt.Println(strings.Repeat("=", 56))
	fmt.Println()

	fmt.Println("[1/4] 加载候选池")
	items, err := loadRSSStateAsItems(config.StatePath)
	if err != nil {
		fmt.Printf("失败：无法读取 RSS 快照：%v\n", err)
		fmt.Println("   请先跑 bun run rss 生成 rss-state.json。")
		return 1
	}
	if len(items) == 0 {
		fmt.Println("失败：rss-state.json 为空，没有可用的候选。")
		fmt.Println("   请先跑 bun run rss 抓取内容。")
		return 1
	}
	fmt.Printf("   完成：候选池 %d 条\n\n", len(items))

	fmt.Println("[2/4] 匹配人工 pick")
	hashToIndex := make(map[string]int, len(items))
	for i, item := range items {
		hashToIndex[itemFingerprint(item)] = i + 1
	}
	pickedIndexes := make(map[int]bool)
	var unmatched int
	for hash := range picks {
		idx, ok := hashToIndex[hash]
		if !ok {
			unmatched++
			continue
		}
		pickedIndexes[idx] = true
	}
	if unmatched > 0 {
		fmt.Printf("   ⚠️  警告：%d 条 pick 在本次候选池里找不到（可能已过期），已跳过\n", unmatched)
	}
	if len(pickedIndexes) == 0 {
		fmt.Println("失败：所有 pick 都不在本次候选池里。")
		fmt.Println("   请确认 rss-state.json 是最新的（重跑 bun run rss），再重新 bun run rss:pick。")
		return 1
	}
	fmt.Printf("   完成：命中 %d 条 pick\n\n", len(pickedIndexes))

	fmt.Println("[3/4] 生成视频 Tabs 与字幕")
	// 每条 picked 独立成单来源 Story：人工已挑，不走评分/聚类/合并（跳过原 [3/6][4/6][4.5]）。
	// 每 Story 只 1 个来源 → 不存在合并吞 picked、representativeSourceIndexes 挤出 两坑。
	groups := make([]NewsGroup, 0, len(pickedIndexes))
	for i, item := range items {
		idx := i + 1
		if !pickedIndexes[idx] {
			continue
		}
		groups = append(groups, NewsGroup{
			Title:         item.Title,
			Score:         10,
			Reason:        "人工 pick",
			SourceIndexes: []int{idx},
			Highlights:    []NewsHighlight{{Index: idx, Point: item.Title}},
		})
	}
	// pickedGroupIndexes 标记所有 group 为 picked：质量重写后仍不合格则逐条警告并跳过，
	// 不把原文碎片静默补进成片，也不让单条失败拖垮其它 picks。
	pickedGroupIndexes := make(map[int]bool, len(groups))
	for i := range groups {
		pickedGroupIndexes[i] = true
	}
	groups, err = generateStoryTabs(config.AI, groups, items, pickedGroupIndexes)
	if err != nil {
		fmt.Printf("失败：AI Tabs 编排失败：%v\n", err)
		fmt.Println("   请检查模型服务可用性后重试 `bun run video`。")
		return 1
	}
	fmt.Printf("   完成：%d 个新闻主题已完成视频编排\n\n", len(groups))

	printNewsGroups(groups, items)

	fmt.Println("\n[4/4] 生成 Remotion data.json")
	if err := generateDataJSON(reportPath, groups, items); err != nil {
		fmt.Printf("失败：data.json 生成失败：%v\n", err)
		return 1
	}
	fmt.Printf("   完成：写入 %s\n", reportPath)
	state, err := loadRSSState(config.StatePath)
	if err != nil {
		fmt.Printf("失败：data.json 已生成，但无法读取 RSS 状态以保存人工选择历史：%v\n", err)
		return 1
	}
	remembered := rememberPickedHashes(&state, picks)
	if err := saveRSSState(config.StatePath, state); err != nil {
		fmt.Printf("失败：data.json 已生成，但无法保存人工选择去重历史：%v\n", err)
		return 1
	}
	fmt.Printf("   完成：新增记录 %d 条人工 pick 到跨次去重历史\n", remembered)
	fmt.Printf("\n全部完成：人工 pick %d 条，生成 %d 个新闻主题。\n",
		len(pickedIndexes), len(groups))
	return 0
}

// runAuto 对应 `bun run video:auto-generate`（全自动路径），等价原 run()：
// 抓取 → 评分 → 聚类 → 合并 → Tabs(识图) → data.json。
func runAuto() int {
	config, err := loadConfig()
	if err != nil {
		fmt.Printf("失败：启动配置无效：%v\n", err)
		fmt.Println("   请检查项目根目录 .env、ingest/sources.jsonc 和 ingest/preferences.jsonc。")
		return 1
	}
	previousState, historyErr := loadRSSState(config.StatePath)
	if historyErr != nil {
		fmt.Printf("⚠️  警告：无法读取旧人工 pick 去重历史，将从空历史继续：%v\n", historyErr)
		previousState = RSSState{Items: make(map[string]StateItem), Picked: make(map[string]bool)}
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
		fmt.Printf("   ⚠️  警告：来源 %s 抓取失败：%v\n", sourceID, fetchErr)
	}
	if len(fetchFailures) == len(config.Sources) {
		fmt.Println("失败：所有 RSS 来源均抓取失败。")
		return 1
	}
	fmt.Printf("   完成：时间窗口内共 %d 条\n\n", len(fetchedItems))

	fmt.Println("[2/6] 保存抓取快照")
	nextState := snapshotRSSState(fetchedItems)
	mergePickedHistory(&nextState, previousState)
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
	// tie-break（同分时新内容优先）保证。
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
		fmt.Println("   请检查 .env 的 AI_API_KEY/AI_BASE_URL/AI_MODEL 与模型服务可用性后重试。")
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
		fmt.Println("   请检查模型服务可用性后重试。")
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
	// 全自动路径无 picked group：传 nil，走原剔除逻辑（Tab 不足的 Story 直接剔除）。
	groups, err = generateStoryTabs(config.AI, groups, items, nil)
	if err != nil {
		fmt.Printf("失败：AI Tabs 编排失败：%v\n", err)
		fmt.Println("   请检查模型服务可用性后重试。")
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
