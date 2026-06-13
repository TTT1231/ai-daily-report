package main

import (
	"html"
	"strings"
	"unicode"
)

func itemSourceText(item Item) string {
	text := stripHTML(item.Description)
	if text == "" {
		return item.Title
	}
	return truncateRunes(text, maxSourceTextRunes)
}

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
