package main

import "strings"

// truncateRunes 按 rune 数截断字符串，超出 limit 时末尾补省略号。
func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	if limit <= 1 {
		return "…"
	}
	return string(runes[:limit-1]) + "…"
}
