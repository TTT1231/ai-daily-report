package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Picks 是人工 pick 的白名单：key 是 itemFingerprint 生成的 hash（与 rss-state.json 的 key 同源），
// value 固定为 true。run-picks 阶段读它，把命中的条目强制独立成 Story。
type Picks map[string]bool

// defaultPicksPath 返回 picks.json 的绝对路径，与 rss-state.json 同目录。
func defaultPicksPath() (string, error) {
	root, err := projectRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, filepath.FromSlash(picksRelativePath)), nil
}

// loadPicks 读取 picks.json；文件不存在时返回空 map（视为本次无人工 pick，走全自动路径）。
func loadPicks(path string) (Picks, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return make(Picks), nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取 picks 失败: %w", err)
	}
	// 空文件视为无 pick，避免 JSON 解析报错。
	if len(data) == 0 {
		return make(Picks), nil
	}
	var picks Picks
	if err := json.Unmarshal(data, &picks); err != nil {
		return nil, fmt.Errorf("解析 picks 失败: %w", err)
	}
	if picks == nil {
		picks = make(Picks)
	}
	return picks, nil
}

// savePicks 原子写入 picks.json：先写临时文件再改名，与 saveRSSState 一致。
func savePicks(path string, picks Picks) error {
	data, err := json.MarshalIndent(picks, "", "  ")
	if err != nil {
		return fmt.Errorf("编码 picks 失败: %w", err)
	}
	data = append(data, '\n')
	if err := writeFileAtomic(path, data, 0o755, 0o644); err != nil {
		return fmt.Errorf("原子写 picks 失败: %w", err)
	}
	return nil
}
