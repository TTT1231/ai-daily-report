package main

import (
	"fmt"
	"time"
)

func main() {
	apiKey, err := loadEnv()
	if err != nil {
		fmt.Printf("⚠ 加载 .env 失败: %v\n", err)
		fmt.Println("请在 ai-daily-report 项目根目录的 .env 中设置 DEEPSEEK_API_KEY=你的密钥")
		return
	}

	fmt.Println("📡 正在获取前沿快讯...")
	items, err := fetchRecentItems(24 * time.Hour)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	if len(items) == 0 {
		fmt.Println("最近 24 小时内没有新帖子")
		return
	}
	fmt.Printf("✅ 获取到 %d 条帖子\n\n", len(items))

	fmt.Println("🤖 DeepSeek 正在分析重要性...")
	scored, err := analyzeWithDeepSeek(apiKey, items)
	if err != nil {
		fmt.Printf("⚠ DeepSeek 评分失败，使用代码级兴趣规则继续流程: %v\n", err)
		scored = applyKeywordWeights(nil, items)
	}
	if len(scored) == 0 {
		fmt.Println("没有符合个人兴趣规则的新闻")
		return
	}

	fmt.Println("🧩 正在合并相似内容并保留独立要点...")
	groups, err := groupSimilarNews(apiKey, scored, items)
	if err != nil {
		fmt.Printf("⚠ 相似内容合并失败，使用本地降级分组: %v\n", err)
		groups = fallbackGroups(scored)
	}

	fmt.Println("🎬 正在根据首帖正文编排视频 Tabs...")
	groups, err = generateStoryTabs(apiKey, groups, items)
	if err != nil {
		fmt.Printf("⚠ Tabs 编排失败，使用本地保底结构: %v\n", err)
		groups = withFallbackStoryTabs(groups)
	}

	printNewsGroups(groups, items)

	reportPath, err := defaultReportDataPath()
	if err != nil {
		fmt.Printf("⚠ 无法确定 data.json 输出位置: %v\n", err)
		return
	}
	if err := writeReportData(reportPath, groups, items); err != nil {
		fmt.Printf("⚠ 构建 data.json 失败: %v\n", err)
		return
	}
	fmt.Printf("\n✅ 已构建 Remotion data.json: %s\n", reportPath)
}
