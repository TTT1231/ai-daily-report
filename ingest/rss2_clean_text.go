package main

import (
	"html"
	"regexp"
	"strings"
	"unicode"
)

// retractedHTMLPattern 匹配语义上已删除/撤回的 HTML 内容。循环替换可处理嵌套标签，
// 避免普通 stripHTML 只删标签、却把被划掉的旧主张继续送给模型。
var retractedHTMLPattern = regexp.MustCompile(`(?is)<(?:s|del|strike)\b[^>]*>.*?</(?:s|del|strike)\s*>`)

// cleanRSS2ItemText 取 RSS 2.0 条目正文的纯文本作为模型材料；正文为空时回退到标题。
func cleanRSS2ItemText(item Item) string {
	text := stripHTML(removeRetractedHTML(item.Description))
	if text == "" {
		return item.Title
	}
	return truncateRunes(text, maxSourceTextRunes)
}

func removeRetractedHTML(value string) string {
	value = html.UnescapeString(value)
	for {
		cleaned := retractedHTMLPattern.ReplaceAllString(value, " ")
		if cleaned == value {
			return cleaned
		}
		value = cleaned
	}
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
