package main

import (
	"crypto/tls"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

func newHTTPClient() *http.Client {
	proxyURL := getProxyURL()
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		MaxIdleConns:        10,
		IdleConnTimeout:     30 * time.Second,
		DisableKeepAlives:   false,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	if proxyURL != nil {
		transport.Proxy = http.ProxyURL(proxyURL)
		fmt.Printf("📡 使用代理: %s\n", proxyURL)
	}

	return &http.Client{Timeout: 15 * time.Second, Transport: transport}
}

func getProxyURL() *url.URL {
	for _, envKey := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		if val := os.Getenv(envKey); val != "" {
			if u, err := url.Parse(val); err == nil {
				return u
			}
		}
	}

	for _, addr := range []string{
		"http://127.0.0.1:7890",
		"http://127.0.0.1:7897",
		"http://127.0.0.1:1080",
		"http://127.0.0.1:10809",
	} {
		u, _ := url.Parse(addr)
		if testPort(u.Host) {
			return u
		}
	}
	return nil
}

func testPort(host string) bool {
	conn, err := net.DialTimeout("tcp", host, 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func fetchRecentItems(within time.Duration) ([]Item, error) {
	client := newHTTPClient()
	cutoff := time.Now().Add(-within)
	seen := make(map[string]bool)
	var allRecent []Item

	for page := 0; page < maxPages; page++ {
		u := fmt.Sprintf("%s?page=%d", rssBase, page)
		items, oldest, err := fetchPage(client, u, cutoff)
		if err != nil {
			fmt.Printf("⚠ page=%d 请求失败: %v\n", page, err)
			break
		}
		for _, item := range items {
			if !seen[item.Link] {
				seen[item.Link] = true
				allRecent = append(allRecent, item)
			}
		}
		if !oldest.After(cutoff) {
			break
		}
		if page < maxPages-1 {
			time.Sleep(pageDelay)
		}
	}
	return allRecent, nil
}

func fetchPage(client *http.Client, rawURL string, cutoff time.Time) ([]Item, time.Time, error) {
	var body []byte
	var err error
	for retry := 0; retry < 3; retry++ {
		body, err = doGet(client, rawURL)
		if err == nil {
			break
		}
		if retry < 2 {
			wait := time.Duration(retry+1) * 10 * time.Second
			fmt.Printf("   ⏳ 第 %d 次重试，等待 %v...\n", retry+1, wait)
			time.Sleep(wait)
		}
	}
	if err != nil {
		return nil, time.Time{}, err
	}

	var rss RSS
	if err := xml.Unmarshal(body, &rss); err != nil {
		return nil, time.Time{}, fmt.Errorf("解析 XML 失败: %w", err)
	}

	var recent []Item
	var oldest time.Time
	for _, item := range rss.Channel.Items {
		t, err := time.Parse(timeLayout, item.PubDate)
		if err != nil {
			continue
		}
		if oldest.IsZero() || t.Before(oldest) {
			oldest = t
		}
		if t.After(cutoff) {
			recent = append(recent, item)
		}
	}
	return recent, oldest, nil
}

func doGet(client *http.Client, rawURL string) ([]byte, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("HTTP 429 限流")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP 状态码: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应体失败: %w", err)
	}
	return body, nil
}
