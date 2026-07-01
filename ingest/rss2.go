package main

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
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

// maxFeedBytes 限制单个 RSS 响应体的最大字节数，避免恶意/损坏的 feed 返回超大 body 拖垮内存。
const maxFeedBytes int64 = 10 * 1024 * 1024

// rssRetrySleep 是 fetchRSS2Page 重试退避的睡眠函数，默认 time.Sleep；测试可替换为 no-op 加速。
var rssRetrySleep = time.Sleep

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
// 当某页没有任何时间窗内的条目（已翻到窗口之外）时停止翻页，并在翻页间按配置延迟。
// 不再用「全页最旧条目」判断停止：置顶/旧帖混在某一页会把最旧值拉低、错误截断后续页。
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
		items, err := fetchRSS2Page(client, rawURL, source, cutoff)
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
		if len(items) == 0 {
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
func fetchRSS2Page(client *http.Client, rawURL string, source RSS2Source, cutoff time.Time) ([]Item, error) {
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
		rssRetrySleep(wait)
	}
	if err != nil {
		return nil, err
	}

	items, err := parseRSS2(body, source)
	if err != nil {
		return nil, err
	}
	var recent []Item
	for _, item := range items {
		if item.PublishedAt.IsZero() {
			continue
		}
		if item.PublishedAt.After(cutoff) {
			recent = append(recent, item)
		}
	}
	return recent, nil
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
		publishedAt, pubErr := parseFeedTime(raw.PubDate)
		if pubErr != nil && strings.TrimSpace(raw.PubDate) != "" {
			fmt.Printf("   ⚠️  警告：来源 %s 的条目时间 %q 无法解析，已跳过该条目\n", source.ID, raw.PubDate)
		}
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
	if fullCookie := os.Getenv("LINUXDO_CF_CLEARANCE"); fullCookie != "" {
		if u, err := url.Parse(rawURL); err == nil {
			host := strings.ToLower(u.Hostname())
			if host == "linux.do" || strings.HasSuffix(host, ".linux.do") {
				req.Header.Set("Cookie", fullCookie)
				if browserUA := os.Getenv("LINUXDO_USER_AGENT"); browserUA != "" {
					req.Header.Set("User-Agent", browserUA)
				}
			}
		}
	}

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
	if resp.ContentLength > maxFeedBytes {
		return nil, &httpError{message: fmt.Sprintf("订阅体过大: Content-Length %d 超过 %d 字节", resp.ContentLength, maxFeedBytes), retryable: false}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取响应体失败: %w", err)
	}
	if int64(len(body)) > maxFeedBytes {
		return nil, &httpError{message: fmt.Sprintf("订阅体过大: 超过 %d 字节上限", maxFeedBytes), retryable: false}
	}
	return body, nil
}

// maxRetryAfterWait 限制单次 Retry-After 退避的上限：恶意/异常 feed 用 Retry-After: 86400
// 之类的大值会让抓取器 sleep 数小时甚至数天，实质性挂死整条日报流水线（http.Client.Timeout
// 不覆盖重试间的 time.Sleep）。裁到这个上限既能尊重服务器的限流指引，又不给单源可乘之机。
const maxRetryAfterWait = 60 * time.Second

// parseRetryAfter 解析 Retry-After 响应头：支持秒数与 HTTP 日期，无法识别时返回 0。
// 返回值裁到 [0, maxRetryAfterWait]：负值与过去的 HTTP 日期都视为无指引（返回 0，由调用方
// 走默认退避），过大值裁到上限。
func parseRetryAfter(resp *http.Response) time.Duration {
	value := strings.TrimSpace(resp.Header.Get("Retry-After"))
	if value == "" {
		return 0
	}
	var d time.Duration
	if seconds, err := strconv.Atoi(value); err == nil {
		d = time.Duration(seconds) * time.Second
	} else if t, err := http.ParseTime(value); err == nil {
		d = time.Until(t)
	}
	if d < 0 {
		return 0
	}
	if d > maxRetryAfterWait {
		return maxRetryAfterWait
	}
	return d
}
