package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

type RSSState struct {
	Items map[string]StateItem `json:"items"`
	// Picked 只保存用户手动挑选过的稳定指纹。单纯抓到但未勾选的条目不进入这里，
	// 所以下一次半自动抓取仍会展示它们；只有已经人工选过的内容会被跨次去重。
	Picked map[string]bool `json:"picked,omitempty"`
}

// StateItem 存的是 rss-state.json 里每条候选的完整字段。
// 字段必须足以从 loadRSSStateAsItems 还原出等价的 Item：CanonicalID 是 itemFingerprint 的
// 命门（hash 由它决定，丢了则 picks.json 的 hash 对不上），Description 是 [5/6] 识图抽图 URL 的来源。
type StateItem struct {
	SourceID    string    `json:"sourceId,omitempty"`
	Title       string    `json:"title"`
	Link        string    `json:"link,omitempty"`
	ID          string    `json:"id,omitempty"`
	StableID    string    `json:"stableId,omitempty"`
	CanonicalID string    `json:"canonicalId,omitempty"`
	SourceName  string    `json:"sourceName,omitempty"`
	PubDate     string    `json:"pubDate,omitempty"`
	PublishedAt time.Time `json:"publishedAt,omitempty"`
	Description string    `json:"description,omitempty"`
}

// loadRSSState 读取最近一次抓取快照；文件不存在时返回空状态。
func loadRSSState(path string) (RSSState, error) {
	state := RSSState{
		Items:  make(map[string]StateItem),
		Picked: make(map[string]bool),
	}
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
	if state.Picked == nil {
		state.Picked = make(map[string]bool)
	}
	return state, nil
}

// filterUnpickedItems 返回尚未被用户手动挑选过的条目。
// 是否曾被 RSS 抓到不影响结果，只有 Picked 中的稳定指纹会参与跨次去重。
func filterUnpickedItems(items []Item, state RSSState) []Item {
	unpicked := make([]Item, 0, len(items))
	for _, item := range items {
		hash := itemFingerprint(item)
		if state.Picked[hash] {
			continue
		}
		unpicked = append(unpicked, item)
	}
	return unpicked
}

// snapshotRSSState 用给定条目创建可复用候选快照；抓取本身不会把条目标记为已挑选。
func snapshotRSSState(items []Item) RSSState {
	state := RSSState{
		Items:  make(map[string]StateItem, len(items)),
		Picked: make(map[string]bool),
	}
	for _, item := range items {
		hash := itemFingerprint(item)
		state.Items[hash] = StateItem{
			SourceID:    item.SourceID,
			Title:       item.Title,
			Link:        item.Link,
			ID:          item.ID,
			StableID:    item.StableID,
			CanonicalID: item.CanonicalID,
			SourceName:  item.SourceName,
			PubDate:     item.PubDate,
			PublishedAt: item.PublishedAt,
			Description: item.Description,
		}
	}
	return state
}

// mergePickedHistory 把已经人工挑选过的历史并入新候选快照。
func mergePickedHistory(next *RSSState, previous RSSState) {
	if next.Picked == nil {
		next.Picked = make(map[string]bool)
	}
	for hash, picked := range previous.Picked {
		if picked {
			next.Picked[hash] = true
		}
	}
}

// rememberPickedHashes 把 picks.json 中仍属于当前候选池的人工选择写入去重历史。
// 返回新增记录数；过期或伪造的 hash 不进入历史。
func rememberPickedHashes(state *RSSState, picks Picks) int {
	if state.Picked == nil {
		state.Picked = make(map[string]bool)
	}
	added := 0
	for hash, picked := range picks {
		if !picked {
			continue
		}
		if _, exists := state.Items[hash]; !exists {
			continue
		}
		if !state.Picked[hash] {
			added++
		}
		state.Picked[hash] = true
	}
	return added
}

// loadRSSStateAsItems 把 rss-state.json 里的 StateItem 还原成 []Item，供 run-picks 阶段重构候选池。
// 排序固定为 PublishedAt desc、hash asc：Go map 迭代序不确定，固定排序避免评分 prompt 序号漂移，
// 与 fetchRecentItems（sources.go 按 PublishedAt desc 排序）保持一致。
func loadRSSStateAsItems(path string) ([]Item, error) {
	state, err := loadRSSState(path)
	if err != nil {
		return nil, err
	}
	type entry struct {
		hash string
		item Item
	}
	entries := make([]entry, 0, len(state.Items))
	for hash, s := range state.Items {
		entries = append(entries, entry{hash: hash, item: Item{
			ID:          s.ID,
			StableID:    s.StableID,
			CanonicalID: s.CanonicalID,
			SourceID:    s.SourceID,
			SourceName:  s.SourceName,
			Title:       s.Title,
			Link:        s.Link,
			PubDate:     s.PubDate,
			PublishedAt: s.PublishedAt,
			Description: s.Description,
		}})
	}
	sort.Slice(entries, func(i, j int) bool {
		if !entries[i].item.PublishedAt.Equal(entries[j].item.PublishedAt) {
			return entries[i].item.PublishedAt.After(entries[j].item.PublishedAt)
		}
		return entries[i].hash < entries[j].hash
	})
	items := make([]Item, len(entries))
	for i, e := range entries {
		items[i] = e.item
	}
	return items, nil
}

// saveRSSState 原子地覆盖写入最近一次抓取快照：先写同目录临时文件再改名，
// 避免进程中途被杀导致 rss-state.json 写成半截而丢失快照内容。
func saveRSSState(path string, state RSSState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("编码 RSS 状态失败: %w", err)
	}
	data = append(data, '\n')
	if err := writeFileAtomic(path, data, 0o755, 0o644); err != nil {
		return fmt.Errorf("原子写 RSS 状态失败: %w", err)
	}
	return nil
}

// itemFingerprint 为条目生成稳定的唯一指纹：优先使用跨来源 CanonicalID；
// 否则使用来源 ID 与条目 ID、链接或标题时间兜底，生成不泄露原始内容的 SHA-256 快照键。
func itemFingerprint(item Item) string {
	identity := strings.TrimSpace(item.CanonicalID)
	sourceID := ""
	if identity == "" {
		sourceID = strings.TrimSpace(item.SourceID)
		identity = strings.TrimSpace(item.ID)
		if identity == "" {
			identity = strings.TrimSpace(item.Link)
		}
		if identity == "" {
			identity = normalizeTitle(item.Title) + "|" + item.PublishedAt.UTC().Format(time.RFC3339)
		}
	}
	hash := sha256.Sum256([]byte(sourceID + "\x00" + identity))
	return hex.EncodeToString(hash[:])
}
