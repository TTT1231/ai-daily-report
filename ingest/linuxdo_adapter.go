package main

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var (
	// Discourse appends this Linux.do navigation footer to every topic RSS description.
	// Strip it in the source adapter so generic RSS cleanup stays source-agnostic.
	linuxDoFooterHTMLPattern = regexp.MustCompile(`(?is)<p[^>]*>\s*<small[^>]*>\s*\d+\s*个帖子\s*-\s*\d+\s*位参与者\s*</small>\s*</p>\s*<p[^>]*>\s*<a[^>]*>\s*阅读完整话题\s*</a>\s*</p>\s*$`)
	linuxDoFooterTextPattern = regexp.MustCompile(`(?s)\s*\d+\s*个帖子\s*-\s*\d+\s*位参与者\s*阅读完整话题\s*$`)
)

// linuxDoPageURL 使用 Linux.do RSS 支持的 page 查询参数构造分页地址。
func linuxDoPageURL(rawURL string, page int) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("无效 Linux.do RSS URL: %w", err)
	}
	query := parsed.Query()
	query.Set("page", fmt.Sprintf("%d", page))
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

// linuxDoTopicID 从 Linux.do 话题链接中提取数字话题 ID。
func linuxDoTopicID(link string) string {
	const marker = "/t/topic/"
	position := strings.Index(link, marker)
	if position == -1 {
		return ""
	}
	remainder := link[position+len(marker):]
	if slash := strings.IndexByte(remainder, '/'); slash != -1 {
		remainder = remainder[:slash]
	}
	for _, r := range remainder {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return remainder
}

// adaptLinuxDoItem 把 Linux.do 话题号转换为下游可复用的稳定 ID。
func adaptLinuxDoItem(item Item) Item {
	item.Description = cleanLinuxDoDescription(item.Description)
	if topicID := linuxDoTopicID(item.Link); topicID != "" {
		item.StableID = "topic-" + topicID
		item.CanonicalID = "linuxdo:topic:" + topicID
	}
	return item
}

func cleanLinuxDoDescription(description string) string {
	description = linuxDoFooterHTMLPattern.ReplaceAllString(description, "")
	return strings.TrimSpace(linuxDoFooterTextPattern.ReplaceAllString(description, ""))
}
