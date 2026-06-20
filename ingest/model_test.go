package main

import (
	"strings"
	"testing"
)

// TestParseScoredItemsRepairsUnquotedReason 回归测试：deepseek-v4-flash 偶发会丢掉
// reason 值的左引号（形如 "reason": 智谱...。"），此前会让整体解析失败、逐行恢复也
// 失败，最终整批降级为本地关键词兜底。现在应能自动修复并解析出全部条目。
func TestParseScoredItemsRepairsUnquotedReason(t *testing.T) {
	// 摘自一次真实的失败现场：每条 reason 都缺左引号。
	content := `[
  {"index": 8, "title": "GLM 5.2的分数出来了", "score": 9, "reason": 智谱新模型GLM 5.2跑分公布。"},
  {"index": 11, "title": "AlphaFold之父加入Anthropic", "score": 9, "reason": 重大人才变动加入Anthropic。"},
  {"index": 33, "title": "Claude Code 额度异常已修复", "score": 8, "reason": Claude Code额度异常及修复重置。"}
]`

	scored, err := parseScoredItems(content)
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if len(scored) != 3 {
		t.Fatalf("期望恢复 3 条，实际 %d 条：%+v", len(scored), scored)
	}
	if scored[0].Score != 9 || scored[0].Title != "GLM 5.2的分数出来了" {
		t.Fatalf("首条不符预期：%+v", scored[0])
	}
	if !strings.Contains(scored[0].Reason, "智谱新模型") {
		t.Fatalf("reason 文本未正确恢复：%q", scored[0].Reason)
	}
}

// TestRepairUnquotedStringsIdempotent 确认对合法 JSON 不会改动、修复后幂等。
func TestRepairUnquotedStringsIdempotent(t *testing.T) {
	valid := `{"index": 1, "title": "正常标题", "score": 9, "reason": "正常说明"}`
	if got := repairUnquotedStrings(valid); got != valid {
		t.Fatalf("合法 JSON 被错误改动：%s", got)
	}
	once := repairUnquotedStrings(`{"reason": 缺左引号。"}`)
	if once == `{"reason": 缺左引号。"}` {
		t.Fatalf("未完成修复：%s", once)
	}
	twice := repairUnquotedStrings(once)
	if twice != once {
		t.Fatalf("修复应幂等，二次结果不同：%s", twice)
	}
}
