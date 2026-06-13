package main

import (
	"html"
	"strings"
	"unicode"
)

// cleanRSS2ItemText 取 RSS 2.0 条目正文的纯文本作为模型材料；正文为空时回退到标题。
func cleanRSS2ItemText(item Item) string {
	text := stripHTML(item.Description)
	if text == "" {
		return item.Title
	}
	return truncateRunes(text, maxSourceTextRunes)
}

// stripHTML 用简易状态机移除 HTML 标签、反转义实体并把连续空白合并为单个空格。
func stripHTML(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}

	var result strings.Builder
	inTag := false
	for _, r := range html.UnescapeString(value) {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
			result.WriteRune(' ')
		default:
			if !inTag {
				result.WriteRune(r)
			}
		}
	}
	return strings.Join(strings.FieldsFunc(result.String(), unicode.IsSpace), " ")
}
