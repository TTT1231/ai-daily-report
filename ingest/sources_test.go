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
