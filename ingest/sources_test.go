package main

import "testing"

// buildSource 应把 SourceDefinition.Proxy 原样传进 RSS2Source，
// 这样 fetchRecentItems 才能按来源构造代理/直连 client。
func TestBuildSourceCarriesProxyPolicy(t *testing.T) {
	tests := []struct {
		name  string
		proxy bool
	}{
		{"opts in", true},
		{"opts out", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source, err := buildSource(SourceDefinition{
				ID:       "s1",
				Name:     "示例来源",
				Adapter:  "rss2",
				URL:      "https://example.com/feed.rss",
				Enabled:  true,
				Proxy:    tt.proxy,
				MaxPages: 1,
			})
			if err != nil {
				t.Fatalf("buildSource error = %v", err)
			}
			if source.Proxy != tt.proxy {
				t.Fatalf("source.Proxy = %v, want %v", source.Proxy, tt.proxy)
			}
		})
	}
}

// buildSource 对 maxPages 的处理随适配器不同：rss2 单页抓取（省略即 1，禁止翻页），
// linuxdo 需要显式翻页数。这里锁定两条分支各自的边界行为，防止以后回退成"rss2 必须填 1"。
func TestBuildSourceMaxPages(t *testing.T) {
	tests := []struct {
		name      string
		adapter   string
		maxPages  int
		wantErr   bool
		wantPages int // 期望 buildSource 归一化后的 source.MaxPages；wantErr 为 true 时不校验
	}{
		{"rss2 省略 maxPages 默认 1", "rss2", 0, false, 1},
		{"rss2 显式 1 合法", "rss2", 1, false, 1},
		{"rss2 显式 2 报错（不支持分页）", "rss2", 2, true, 0},
		{"linuxdo 省略 maxPages 报错（必须翻页）", "linuxdo", 0, true, 0},
		{"linuxdo 显式 2 合法", "linuxdo", 2, false, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			feedURL := "https://example.com/feed.rss"
			if tt.adapter == "linuxdo" {
				feedURL = "https://linux.do/c/news/34.rss"
			}
			source, err := buildSource(SourceDefinition{
				ID:       "s1",
				Name:     "示例来源",
				Adapter:  tt.adapter,
				URL:      feedURL,
				Enabled:  true,
				MaxPages: tt.maxPages,
			})
			if tt.wantErr {
				if err == nil {
					t.Fatalf("期望报错，实际 err = nil; source=%#v", source)
				}
				return
			}
			if err != nil {
				t.Fatalf("buildSource error = %v", err)
			}
			if source.MaxPages != tt.wantPages {
				t.Fatalf("source.MaxPages = %d, want %d", source.MaxPages, tt.wantPages)
			}
		})
	}
}
