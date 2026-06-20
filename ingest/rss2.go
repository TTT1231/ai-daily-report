package main

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// httpError 标记可重试的 HTTP/网络错误，并携带 Retry-After 建议等待时长。
type httpError struct {
	message    string
	retryable  bool
	retryAfter time.Duration
}

func (e *httpError) Error() string { return e.message }

type rss2Document struct {
	XMLName xml.Name    `xml:"rss"`
	Version string      `xml:"version,attr"`
	Channel rss2Channel `xml:"channel"`
}

type rss2Channel struct {
	Items []rss2Item `xml:"item"`
}

type rss2Item struct {
	GUID        string `xml:"guid"`
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	PubDate     string `xml:"pubDate"`
	Description string `xml:"description"`
	Content     string `xml:"encoded"`
	Creator     string `xml:"creator"`
}

// fetchRSS2Source 抓取单个 RSS 2.0 源（按 MaxPages 翻页），只保留晚于 cutoff 的条目，
// 当某页最旧条目已早于 cutoff 或不分页时停止翻页，并在翻页间按配置延迟。
func fetchRSS2Source(client *http.Client, source RSS2Source, cutoff time.Time) ([]Item, error) {
	if source.PageURL == nil {
		return nil, fmt.Errorf("RSS 来源未配置分页地址生成器")
	}
	var recent []Item
	seen := make(map[string]struct{})
	for pageOffset := 0; pageOffset < source.MaxPages; pageOffset++ {
		rawURL, err := source.PageURL(source.PageStart + pageOffset)
		if err != nil {
			return nil, err
		}
		items, oldest, err := fetchRSS2Page(client, rawURL, source, cutoff)
		if err != nil {
			return nil, fmt.Errorf("第 %d 页: %w", pageOffset+1, err)
		}
		for _, item := range items {
			key := itemFingerprint(item)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			recent = append(recent, item)
		}
		if !oldest.IsZero() && !oldest.After(cutoff) {
			break
		}
		if pageOffset < source.MaxPages-1 && source.PageDelaySeconds > 0 {
			time.Sleep(time.Duration(source.PageDelaySeconds) * time.Second)
		}
	}
	return recent, nil
}

// fetchRSS2Page 抓取单个 RSS 2.0 页面，仅对可重试错误（429 / 5xx / 网络超时）最多重试 3 次，
// 优先遵守 Retry-After 头，否则用递增退避；4xx 等永久错误立即返回。
func fetchRSS2Page(client *http.Client, rawURL string, source RSS2Source, cutoff time.Time) ([]Item, time.Time, error) {
	const maxRetries = 3
	var body []byte
	var err error
	for retry := 0; retry < maxRetries; retry++ {
		body, err = doGet(client, rawURL)
		if err == nil {
			break
		}
		var he *httpError
		retryable := errors.As(err, &he) && he.retryable
		if !retryable || retry == maxRetries-1 {
			break
		}
		wait := he.retryAfter
		if wait <= 0 {
			wait = time.Duration(retry+1) * 10 * time.Second
		}
		fmt.Printf("   重试：第 %d 次请求失败，等待 %v 后继续\n", retry+1, wait)
		time.Sleep(wait)
	}
	if err != nil {
		return nil, time.Time{}, err
	}

	items, err := parseRSS2(body, source)
	if err != nil {
		return nil, time.Time{}, err
	}
	var recent []Item
	var oldest time.Time
	for _, item := range items {
		if item.PublishedAt.IsZero() {
			continue
		}
		if oldest.IsZero() || item.PublishedAt.Before(oldest) {
			oldest = item.PublishedAt
		}
		if item.PublishedAt.After(cutoff) {
			recent = append(recent, item)
		}
	}
	return recent, oldest, nil
}

// parseRSS2 解析 RSS 2.0 格式的 Feed，把每个 <item> 转成标准化 Item。
func parseRSS2(body []byte, source RSS2Source) ([]Item, error) {
	var document rss2Document
	if err := xml.Unmarshal(body, &document); err != nil {
		return nil, fmt.Errorf("解析 RSS 失败: %w", err)
	}
	if document.XMLName.Local != "rss" || document.Version != "2.0" {
		return nil, fmt.Errorf("不支持的订阅格式，仅支持 RSS 2.0")
	}
	rawItems := document.Channel.Items
	items := make([]Item, 0, len(rawItems))
	for _, raw := range rawItems {
		publishedAt, _ := parseFeedTime(raw.PubDate)
		item := normalizeRSS2Item(Item{
			ID:          strings.TrimSpace(raw.GUID),
			SourceID:    source.ID,
			SourceName:  source.Name,
			Title:       strings.TrimSpace(raw.Title),
			Link:        strings.TrimSpace(raw.Link),
			PublishedAt: publishedAt,
			Description: firstNonEmpty(raw.Content, raw.Description),
			Creator:     strings.TrimSpace(raw.Creator),
		})
		if source.AdaptItem != nil {
			item = source.AdaptItem(item)
		}
		items = append(items, item)
	}
	return items, nil
}

// normalizeRSS2Item 清洗单条解析结果：去除标题 HTML、补全缺失的 ID（回退为链接）、格式化展示用发布时间。
func normalizeRSS2Item(item Item) Item {
	item.Title = stripHTML(item.Title)
	item.Link = strings.TrimSpace(item.Link)
	item.ID = strings.TrimSpace(item.ID)
	if item.ID == "" {
		item.ID = item.Link
	}
	if !item.PublishedAt.IsZero() {
		item.PubDate = item.PublishedAt.Format(time.RFC1123)
	}
	return item
}

// parseFeedTime 尝试用一组常见的时间格式解析 Feed 中的发布时间字符串，全部失败时返回错误。
func parseFeedTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		time.RFC1123Z,
		time.RFC1123,
		time.RFC822Z,
		time.RFC822,
		time.RFC850,
		"Mon, 02 Jan 2006 15:04:05 -0700",
		"2006-01-02 15:04:05 -0700",
	} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("不支持的发布时间 %q", value)
}

// firstNonEmpty 返回入参中第一个非空白字符串，全部为空时返回空串。
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// doGet 发起带固定 User-Agent 的 GET 请求，429 / 5xx 与网络错误返回可重试的 *httpError
// （携带 Retry-After），4xx 返回不可重试错误，成功返回响应体字节。
func doGet(client *http.Client, rawURL string) ([]byte, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("User-Agent", "ai-daily-report-rss/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, &httpError{message: "请求失败: " + err.Error(), retryable: true}
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, &httpError{
			message:    "HTTP 429 限流",
			retryable:  true,
			retryAfter: parseRetryAfter(resp),
		}
	case resp.StatusCode >= 500:
		return nil, &httpError{
			message:    fmt.Sprintf("HTTP 状态码: %d", resp.StatusCode),
			retryable:  true,
			retryAfter: parseRetryAfter(resp),
		}
	case resp.StatusCode != http.StatusOK:
		return nil, &httpError{message: fmt.Sprintf("HTTP 状态码: %d", resp.StatusCode), retryable: false}
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应体失败: %w", err)
	}
	return body, nil
}

// parseRetryAfter 解析 Retry-After 响应头：支持秒数与 HTTP 日期，无法识别时返回 0。
func parseRetryAfter(resp *http.Response) time.Duration {
	value := strings.TrimSpace(resp.Header.Get("Retry-After"))
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil {
		return time.Duration(seconds) * time.Second
	}
	if t, err := http.ParseTime(value); err == nil {
		if wait := time.Until(t); wait > 0 {
			return wait
		}
	}
	return 0
}
