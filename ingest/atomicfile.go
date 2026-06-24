package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// writeFileAtomic 先写同目录临时文件再改名，避免进程中途被杀导致目标文件写成半截。
// 目录不存在时按 dirPerm 创建；文件以 filePerm 写入。与 saveRSSState 一致，保证
// data.json 等关键产物要么完整提交、要么完全不变。
func writeFileAtomic(path string, data []byte, dirPerm, filePerm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), dirPerm); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, filePerm); err != nil {
		return fmt.Errorf("写入临时文件失败: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		// Rename 失败时清理残留临时文件：Windows 上目标被编辑器/杀软占用时常失败，
		// 不清理会留下永久的 *.tmp（测试也已承认 stale temp 的存在）。
		_ = os.Remove(tmpPath)
		return fmt.Errorf("提交文件失败: %w", err)
	}
	return nil
}
