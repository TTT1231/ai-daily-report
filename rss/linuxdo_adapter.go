package main

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

const linuxDoRSSURL = "https://linux.do/c/news/34.rss"

// fetchLinuxDoRecentItems 是主流程使用的 Linux.do 抓取入口。
func fetchLinuxDoRecentItems(within time.Duration) ([]Item, error) {
	client := newHTTPClient(defaultFeedRequestTimeout, true)
	return fetchRSS2Source(client, linuxDoSource(), time.Now().Add(-within))
}

// linuxDoSource 定义 Linux.do 前沿快讯 RSS 2.0 的来源信息与分页方式。
func linuxDoSource() RSS2Source {
	return RSS2Source{
		ID:               "linuxdo-news",
		Name:             "Linux.do 前沿快讯",
		MaxPages:         2,
		PageStart:        0,
		PageDelaySeconds: 10,
		PageURL:          linuxDoPageURL,
		AdaptItem:        adaptLinuxDoItem,
	}
}

// linuxDoPageURL 使用 Linux.do RSS 支持的 page 查询参数构造分页地址。
func linuxDoPageURL(page int) (string, error) {
	parsed, err := url.Parse(linuxDoRSSURL)
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
	if topicID := linuxDoTopicID(item.Link); topicID != "" {
		item.StableID = "topic-" + topicID
	}
	return item
}
