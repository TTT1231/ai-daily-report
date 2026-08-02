package main

import "testing"

func TestStripForumDecorations(t *testing.T) {
	cases := []struct{ in, want string }{
		{"各位佬，GPT5.6发布了→仅面向少数可信合作伙伴", "GPT5.6发布了仅面向少数可信合作伙伴"},
		{"【OpenAI博客长文与个人省流】预览 GPT-5.6 Sol", "预览 GPT-5.6 Sol"},
		{"GPT-5.6应美国领导人要求分批发布！！！等7月吧！！！", "GPT-5.6应美国领导人要求分批发布！等7月吧！"},
		{"佬们，DeepSeek官网更新了", "DeepSeek官网更新了"},
		{"快讯：DeepSeek-V4-Flash正式版开始公测", "DeepSeek-V4-Flash正式版开始公测"},
		{"慢讯：详细对比了一下智谱套餐的前后变化", "智谱套餐的前后变化"},
		{"正常新闻标题不变", "正常新闻标题不变"},
		{"", ""},
	}
	for _, c := range cases {
		if got := stripForumDecorations(c.in); got != c.want {
			t.Errorf("stripForumDecorations(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCleanDisplayTitleStripsForumSpeak(t *testing.T) {
	got := cleanDisplayTitle("各位佬，GPT5.6发布了→仅面向少数可信合作伙伴")
	if got != "GPT5.6发布了仅面向少数可信合作伙伴" {
		t.Errorf("cleanDisplayTitle forum speak = %q", got)
	}
}

func TestCleanDisplayTitleRemovesNewsPrefixAndSentencePunctuation(t *testing.T) {
	got := cleanDisplayTitle("快讯：DeepSeek-V4-Flash正式版开始公测。")
	if got != "DeepSeek-V4-Flash正式版开始公测" {
		t.Errorf("cleanDisplayTitle news prefix = %q", got)
	}
}
