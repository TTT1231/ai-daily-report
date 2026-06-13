package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type RSSState struct {
	Items map[string]StateItem `json:"items"`
}

type StateItem struct {
	Title string `json:"title"`
	Link  string `json:"link,omitempty"`
}

// loadRSSState 读取上一次抓取快照；文件不存在时返回空状态。
func loadRSSState(path string) (RSSState, error) {
	state := RSSState{Items: make(map[string]StateItem)}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return state, nil
	}
	if err != nil {
		return state, fmt.Errorf("读取 RSS 状态失败: %w", err)
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return RSSState{}, fmt.Errorf("解析 RSS 状态失败: %w", err)
	}
	if state.Items == nil {
		state.Items = make(map[string]StateItem)
	}
	return state, nil
}

// filterUnseenItems 返回本次抓取中未出现在上一次快照里的条目。
func filterUnseenItems(items []Item, state RSSState) []Item {
	unseen := make([]Item, 0, len(items))
	for _, item := range items {
		if _, exists := state.Items[itemFingerprint(item)]; !exists {
			unseen = append(unseen, item)
		}
	}
	return unseen
}

// snapshotRSSState 用本次完整抓取结果创建下一次比较使用的快照。
func snapshotRSSState(items []Item) RSSState {
	state := RSSState{Items: make(map[string]StateItem, len(items))}
	for _, item := range items {
		state.Items[itemFingerprint(item)] = StateItem{
			Title: item.Title,
			Link:  item.Link,
		}
	}
	return state
}

// saveRSSState 直接覆盖写入上一次抓取快照。
func saveRSSState(path string, state RSSState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("编码 RSS 状态失败: %w", err)
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("创建 RSS 状态目录失败: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("写入 RSS 状态失败: %w", err)
	}
	return nil
}

// itemFingerprint 为条目生成稳定的唯一指纹：优先用 ID，其次链接，最后用标题+发布时间兜底，
// 再与 SourceID 拼接后做 SHA-256，生成稳定且不泄露原始内容的快照键。
func itemFingerprint(item Item) string {
	identity := strings.TrimSpace(item.ID)
	if identity == "" {
		identity = strings.TrimSpace(item.Link)
	}
	if identity == "" {
		identity = normalizeTitle(item.Title) + "|" + item.PublishedAt.UTC().Format(time.RFC3339)
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(item.SourceID) + "\x00" + identity))
	return hex.EncodeToString(hash[:])
}
