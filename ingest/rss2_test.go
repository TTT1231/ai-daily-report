package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// 本文件覆盖 rss2.go 的三层契约：
//   1. doGet 的错误分类（429/5xx 可重试并带 Retry-After；4xx 不可重试；200 返 body）。
//   2. fetchRSS2Page 的重试循环（持续 5xx 重试 3 次后返 error；429→200 重试后成功）。
//   3. fetchRSS2Source 的分页停止判据（本次逻辑修复的重点）：置顶/旧帖混在某一页不会
//      因「全页最旧值」错误截断后续页；某页全旧则停。
//
// 重试循环测试不真睡：测试前把 rssRetrySleep 替换为 no-op（defer 恢复），fetchRSS2Page 的
// 退避 time.Duration 只是被丢弃的入参。

// withNoopRSSRetry 把包级 rssRetrySleep 临时替换为 no-op，返回恢复函数。
// fetchRSS2Page 的退避睡眠由此变快；测试结束后必须调用恢复函数还原，避免污染其它测试。
func withNoopRSSRetry() func() {
	original := rssRetrySleep
	rssRetrySleep = func(time.Duration) {}
	return func() { rssRetrySleep = original }
}

// rssItemXML 渲染单个 <item>，pubDate 用 RFC1123Z（parseFeedTime 支持的格式之一）。
func rssItemXML(guid, title, link string, publishedAt time.Time) string {
	return fmt.Sprintf(
		`<item><guid>%s</guid><title>%s</title><link>%s</link><pubDate>%s</pubDate><description>d</description></item>`,
		guid, title, link, publishedAt.Format(time.RFC1123Z),
	)
}

// rssFeedXML 用给定 <item> 片段拼出一个合法 RSS 2.0 文档（parseRSS2 校验 version="2.0"）。
func rssFeedXML(items ...string) []byte {
	return []byte(`<?xml version="1.0"?><rss version="2.0"><channel>` + strings.Join(items, "") + `</channel></rss>`)
}

// ---------- doGet 错误分类契约 ----------

func TestDoGetClassifies429AsRetryableWithRetryAfter(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	_, err := doGet(http.DefaultClient, server.URL)
	var he *httpError
	if !errors.As(err, &he) {
		t.Fatalf("error should be *httpError, got %T: %v", err, err)
	}
	if !he.retryable {
		t.Fatalf("429 must be retryable")
	}
	if he.retryAfter != 7*time.Second {
		t.Fatalf("retryAfter = %v, want 7s", he.retryAfter)
	}
}

func TestDoGetClassifies5xxAsRetryable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	_, err := doGet(http.DefaultClient, server.URL)
	var he *httpError
	if !errors.As(err, &he) {
		t.Fatalf("error should be *httpError, got %T: %v", err, err)
	}
	if !he.retryable {
		t.Fatalf("500 must be retryable")
	}
}

func TestDoGetClassifies4xxAsNonRetryable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	_, err := doGet(http.DefaultClient, server.URL)
	var he *httpError
	if !errors.As(err, &he) {
		t.Fatalf("error should be *httpError, got %T: %v", err, err)
	}
	if he.retryable {
		t.Fatalf("404 must NOT be retryable")
	}
}

func TestDoGetReturnsBodyOn200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("hello feed"))
	}))
	defer server.Close()

	body, err := doGet(http.DefaultClient, server.URL)
	if err != nil {
		t.Fatalf("200 should not error: %v", err)
	}
	if string(body) != "hello feed" {
		t.Fatalf("body = %q, want %q", string(body), "hello feed")
	}
}

// ---------- fetchRSS2Page 重试循环 ----------

// TestFetchRSS2PageRetriesOnSustained5xxThenErrors：持续 5xx → 重试 3 次后返 error。
// 锁定：rssRetrySleep 被替换为 no-op（不真睡），但仍走满 3 次重试（请求计数 = maxRetries）。
func TestFetchRSS2PageRetriesOnSustained5xxThenErrors(t *testing.T) {
	defer withNoopRSSRetry()()

	var attempts int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusBadGateway) // 502 → retryable
	}))
	defer server.Close()

	source := RSS2Source{ID: "test", Name: "测试源"}
	_, err := fetchRSS2Page(http.DefaultClient, server.URL, source, time.Now())
	if err == nil {
		t.Fatal("expected error after retry exhaustion, got nil")
	}
	// fetchRSS2Page 重试上限 = maxRetries = 3（共 3 次请求，无额外发请求）。
	if got := atomic.LoadInt32(&attempts); got != 3 {
		t.Fatalf("expected 3 attempts (maxRetries), got %d", got)
	}
}

// TestFetchRSS2PageSucceedsAfterRetry：先 429（Retry-After:0）后 200 → 重试后成功返 items。
// 锁定：可重试错误后能恢复并返回窗口内条目，且只过滤出 pubDate > cutoff 的条目。
func TestFetchRSS2PageSucceedsAfterRetry(t *testing.T) {
	defer withNoopRSSRetry()()

	now := time.Now()
	cutoff := now.Add(-24 * time.Hour)
	newItem := rssItemXML("g1", "新条目", "https://x/1", now) // now > cutoff → 保留

	var attempts int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&attempts, 1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests) // 429 → retryable
			return
		}
		_, _ = w.Write(rssFeedXML(newItem))
	}))
	defer server.Close()

	source := RSS2Source{ID: "test", Name: "测试源"}
	items, err := fetchRSS2Page(http.DefaultClient, server.URL, source, cutoff)
	if err != nil {
		t.Fatalf("expected success after retry, got: %v", err)
	}
	if len(items) != 1 || items[0].ID != "g1" {
		t.Fatalf("expected 1 in-window item g1, got %#v", items)
	}
	if got := atomic.LoadInt32(&attempts); got != 2 {
		t.Fatalf("expected 2 attempts (1 retry), got %d", got)
	}
}

// ---------- fetchRSS2Source 分页（本次逻辑修复的重点） ----------

// TestFetchRSS2SourcePinnedPostDoesNotTruncateNextPage：锁修复契约。
// page 1 = 1 个旧帖（pubDate < cutoff）+ 1 个新帖（pubDate > cutoff）；
// page 2 = 1 个新帖。修复前会用「全页最旧值」判断停止、把 page1 的旧帖拉低而截断拿不到 page2；
// 修复后按「本页无窗口内条目才停」判断，page1 有 1 个新条目 → 继续翻 page2。
// 断言：最终拿到 page1 新帖 + page2 新帖共 2 条。
func TestFetchRSS2SourcePinnedPostDoesNotTruncateNextPage(t *testing.T) {
	now := time.Now()
	cutoff := now.Add(-24 * time.Hour)
	oldTime := now.Add(-48 * time.Hour) // 旧帖：早于 cutoff

	page1 := rssFeedXML(
		rssItemXML("old-pinned", "置顶旧帖", "https://x/old", oldTime), // 旧，被窗口过滤
		rssItemXML("new-1", "新帖一", "https://x/new1", now),          // 新，保留
	)
	page2 := rssFeedXML(
		rssItemXML("new-2", "新帖二", "https://x/new2", now), // 新，保留
	)

	var pageCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page := atomic.AddInt32(&pageCalls, 1)
		if page == 1 {
			_, _ = w.Write(page1)
			return
		}
		_, _ = w.Write(page2)
	}))
	defer server.Close()

	source := RSS2Source{
		ID:               "test",
		Name:             "测试源",
		MaxPages:         2,
		PageStart:        1,
		PageDelaySeconds: 0,
		PageURL: func(page int) (string, error) {
			return fmt.Sprintf("%s?page=%d", server.URL, page), nil
		},
	}

	got, err := fetchRSS2Source(http.DefaultClient, source, cutoff)
	if err != nil {
		t.Fatalf("fetchRSS2Source error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 in-window items (new-1 + new-2), got %d: %#v", len(got), got)
	}
	// 置顶旧帖必须被过滤掉，不在结果里。
	ids := map[string]bool{got[0].ID: true, got[1].ID: true}
	if !ids["new-1"] || !ids["new-2"] {
		t.Fatalf("expected new-1 and new-2, got %#v", got)
	}
	if got := atomic.LoadInt32(&pageCalls); got != 2 {
		t.Fatalf("expected both pages fetched, got %d page calls", got)
	}
}

// TestFetchRSS2SourceStopsWhenPageHasNoInWindowItems：全旧则停契约。
// page 1 全部旧（pubDate < cutoff）→ fetchRSS2Page 返回 0 条 → fetchRSS2Source 停止翻页。
// 断言：只请求了 page 1（page 2 没被请求），返回 0 条。
func TestFetchRSS2SourceStopsWhenPageHasNoInWindowItems(t *testing.T) {
	now := time.Now()
	cutoff := now.Add(-24 * time.Hour)
	oldTime := now.Add(-48 * time.Hour)

	page1 := rssFeedXML(
		rssItemXML("old-1", "旧帖一", "https://x/old1", oldTime),
		rssItemXML("old-2", "旧帖二", "https://x/old2", oldTime.Add(-time.Hour)),
	)
	// page 2 本应返回新内容；但因为 page 1 全旧、停止判据触发，page 2 不应被请求。
	// 若停止判据失效，这里会写出新条目并让测试失败（拿到 >0 条）。
	page2 := rssFeedXML(rssItemXML("should-not-fetch", "不应抓到的页", "https://x/never", now))

	var pageCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&pageCalls, 1) == 1 {
			_, _ = w.Write(page1)
			return
		}
		_, _ = w.Write(page2)
	}))
	defer server.Close()

	source := RSS2Source{
		ID:               "test",
		Name:             "测试源",
		MaxPages:         2,
		PageStart:        1,
		PageDelaySeconds: 0,
		PageURL: func(page int) (string, error) {
			return fmt.Sprintf("%s?page=%d", server.URL, page), nil
		},
	}

	got, err := fetchRSS2Source(http.DefaultClient, source, cutoff)
	if err != nil {
		t.Fatalf("fetchRSS2Source error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 items when page 1 is all-old, got %d: %#v", len(got), got)
	}
	if got := atomic.LoadInt32(&pageCalls); got != 1 {
		t.Fatalf("expected only page 1 fetched (stop on all-old), got %d page calls", got)
	}
}

// ---------- parseRetryAfter 上限与边界 ----------

// TestParseRetryAfterCapsAndEdges 锁定 parseRetryAfter 的上限裁剪与边界语义：
//   - 头缺失/0/负数/无法识别 → 0（由调用方走默认退避）；
//   - 正常小值原样返回；
//   - 过大值（恶意 feed 用 Retry-After: 86400 拖垮流水线）裁到 maxRetryAfterWait；
//   - 过去的 HTTP 日期 → 0；遥远的未来 HTTP 日期 → 裁到上限。
func TestParseRetryAfterCapsAndEdges(t *testing.T) {
	withRetryAfter := func(value string) *http.Response {
		resp := &http.Response{Header: http.Header{}}
		if value != "" {
			resp.Header.Set("Retry-After", value)
		}
		return resp
	}

	cases := []struct {
		name    string
		hdr     string
		wantMin time.Duration // 期望返回值落在 [wantMin, wantMax] 内（HTTP-date 用区间，避免精确断言）
		wantMax time.Duration
	}{
		{"missing header", "", 0, 0},
		{"zero seconds", "0", 0, 0},
		{"negative seconds", "-5", 0, 0},
		{"small seconds", "7", 7 * time.Second, 7 * time.Second},
		{"just under cap", "59", 59 * time.Second, 59 * time.Second},
		{"capped large seconds", "86400", maxRetryAfterWait, maxRetryAfterWait},
		{"garbage", "not-a-number", 0, 0},
		{"past http-date", time.Now().Add(-time.Hour).UTC().Format(http.TimeFormat), 0, 0},
		{"far-future http-date caps", time.Now().Add(48 * time.Hour).UTC().Format(http.TimeFormat), maxRetryAfterWait, maxRetryAfterWait},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseRetryAfter(withRetryAfter(tc.hdr))
			if got < tc.wantMin || got > tc.wantMax {
				t.Fatalf("parseRetryAfter(%q) = %v, want in [%v,%v]", tc.hdr, got, tc.wantMin, tc.wantMax)
			}
		})
	}
}
