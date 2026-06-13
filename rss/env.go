package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func loadEnv() (string, error) {
	envPath, err := projectEnvPath()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(envPath)
	if err != nil {
		return "", fmt.Errorf("读取项目根目录 .env 文件失败: %w", err)
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	var apiKey string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
		if key == "DEEPSEEK_API_KEY" {
			apiKey = value
		}
	}

	if apiKey == "" || apiKey == "your_api_key_here" {
		return "", fmt.Errorf("请在 .env 中填写有效的 DEEPSEEK_API_KEY")
	}
	return apiKey, nil
}

func projectRoot() (string, error) {
	current, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("获取当前目录失败: %w", err)
	}
	for _, candidate := range []string{current, filepath.Dir(current)} {
		if _, err := os.Stat(filepath.Join(candidate, "data-schema.json")); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("无法定位 ai-daily-report 项目根目录")
}

func projectEnvPath() (string, error) {
	root, err := projectRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, ".env"), nil
}
