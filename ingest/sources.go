package main

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

type SourcesConfig struct {
	Sources []SourceDefinition `json:"sources"`
}

type SourceDefinition struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Adapter          string `json:"adapter"`
	URL              string `json:"url"`
	Enabled          bool   `json:"enabled"`
	Proxy            bool   `json:"proxy"`
	MaxPages         int    `json:"maxPages"`
	PageStart        int    `json:"pageStart"`
	PageDelaySeconds int    `json:"pageDelaySeconds"`
}

func loadSources(path string) ([]RSS2Source, error) {
	var config SourcesConfig
	if err := readJSONC(path, &config); err != nil {
		return nil, err
	}
	seen := make(map[string]struct{})
	var sources []RSS2Source
	for i, definition := range config.Sources {
		if !definition.Enabled {
			continue
		}
		source, err := buildSource(definition)
		if err != nil {
			return nil, fmt.Errorf("sources[%d] 无效: %w", i, err)
		}
		if _, exists := seen[source.ID]; exists {
			return nil, fmt.Errorf("sources[%d] 使用了重复 id %q", i, source.ID)
		}
		seen[source.ID] = struct{}{}
		sources = append(sources, source)
	}
	if len(sources) == 0 {
		return nil, fmt.Errorf("来源配置中没有启用的来源")
	}
	return sources, nil
}

func buildSource(definition SourceDefinition) (RSS2Source, error) {
	definition.ID = strings.TrimSpace(definition.ID)
	definition.Name = strings.TrimSpace(definition.Name)
	definition.Adapter = strings.ToLower(strings.TrimSpace(definition.Adapter))
	definition.URL = strings.TrimSpace(definition.URL)
	if definition.ID == "" || definition.Name == "" || definition.URL == "" {
		return RSS2Source{}, fmt.Errorf("id、name 和 url 不能为空")
	}
	parsedURL, err := url.ParseRequestURI(definition.URL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		if err == nil {
			err = fmt.Errorf("仅支持带主机名的 http/https 地址")
		}
		return RSS2Source{}, fmt.Errorf("url 不是有效地址: %w", err)
	}
	if definition.PageStart < 0 {
		return RSS2Source{}, fmt.Errorf("pageStart 不能小于 0")
	}
	if definition.PageDelaySeconds < 0 {
		return RSS2Source{}, fmt.Errorf("pageDelaySeconds 不能小于 0")
	}

	// MaxPages 的语义随适配器不同：rss2 单页抓取、maxPages 无意义（省略即 1）；
	// linuxdo 需要翻页、必须显式声明。故校验下放到各 adapter 分支，避免 rss2 被迫
	// 填写一个它用不到的字段。
	source := RSS2Source{
		ID:               definition.ID,
		Name:             definition.Name,
		PageStart:        definition.PageStart,
		PageDelaySeconds: definition.PageDelaySeconds,
		Proxy:            definition.Proxy,
	}
	switch definition.Adapter {
	case "linuxdo":
		if definition.MaxPages < 1 {
			return RSS2Source{}, fmt.Errorf("linuxdo 适配器的 maxPages 必须 ≥ 1")
		}
		source.MaxPages = definition.MaxPages
		source.PageURL = func(page int) (string, error) {
			return linuxDoPageURL(definition.URL, page)
		}
		source.AdaptItem = adaptLinuxDoItem
	case "rss2":
		// rss2 不分页：maxPages 省略（0）或 1 都合法并归一为 1；显式写成其它值说明
		// 误以为能翻页，报错纠正而不是静默吞掉。
		if definition.MaxPages != 0 && definition.MaxPages != 1 {
			return RSS2Source{}, fmt.Errorf("rss2 适配器不支持分页，maxPages 只能为 1 或省略")
		}
		source.MaxPages = 1
		source.PageURL = func(_ int) (string, error) {
			return definition.URL, nil
		}
	default:
		return RSS2Source{}, fmt.Errorf("不支持 adapter %q", definition.Adapter)
	}
	return source, nil
}

// fetchRecentItems 抓取所有启用来源。单个来源失败时保留其他来源的结果，并返回失败来源供快照合并使用。
// 每个来源按其自身的 proxy 策略构建 client（proxy:true 走 all_proxy、否则直连），互不拖累：
// 需要代理的来源（如 linux.do）不会被直连拖到撞 Cloudflare，直连可达的来源也不会被代理抖动拖挂。
func fetchRecentItems(sources []RSS2Source, within time.Duration) ([]Item, map[string]error) {
	cutoff := time.Now().Add(-within)
	var combined []Item
	failures := make(map[string]error)
	for _, source := range sources {
		client, err := newSourceHTTPClient(defaultFeedRequestTimeout, source)
		if err != nil {
			failures[source.ID] = err
			continue
		}
		items, err := fetchRSS2Source(client, source, cutoff)
		if err != nil {
			failures[source.ID] = err
			continue
		}
		combined = append(combined, items...)
	}
	combined = dedupeItems(combined)
	sort.SliceStable(combined, func(i, j int) bool {
		return combined[i].PublishedAt.After(combined[j].PublishedAt)
	})
	return combined, failures
}

// dedupeItems 优先按来源适配器提供的 CanonicalID 跨来源去重，否则回退为来源内指纹去重。
func dedupeItems(items []Item) []Item {
	seen := make(map[string]struct{}, len(items))
	result := make([]Item, 0, len(items))
	for _, item := range items {
		key := itemFingerprint(item)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, item)
	}
	return result
}

func sourceNames(sources []RSS2Source) string {
	names := make([]string, 0, len(sources))
	for _, source := range sources {
		names = append(names, source.Name)
	}
	return strings.Join(names, "、")
}
