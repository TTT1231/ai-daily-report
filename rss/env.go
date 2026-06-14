package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// loadConfig 加载项目 .env 并组装运行时 AppConfig。
func loadConfig() (AppConfig, error) {
	if err := loadProjectEnv(); err != nil {
		return AppConfig{}, err
	}

	root, err := projectRoot()
	if err != nil {
		return AppConfig{}, err
	}
	apiKey := strings.TrimSpace(os.Getenv("AI_API_KEY"))
	if apiKey == "" || apiKey == "your_api_key_here" {
		return AppConfig{}, fmt.Errorf("请在项目根目录 .env 中填写有效的 AI_API_KEY")
	}

	extraBody := make(map[string]any)
	if raw := strings.TrimSpace(os.Getenv("AI_EXTRA_BODY_JSON")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &extraBody); err != nil {
			return AppConfig{}, fmt.Errorf("AI_EXTRA_BODY_JSON 不是有效 JSON: %w", err)
		}
	}

	return AppConfig{
		AI: AIConfig{
			APIKey:    apiKey,
			BaseURL:   strings.TrimRight(envOrDefault("AI_BASE_URL", defaultAIBaseURL), "/"),
			Model:     envOrDefault("AI_MODEL", defaultAIModel),
			ExtraBody: extraBody,
		},
		Lookback:  rssLookback,
		StatePath: filepath.Join(root, filepath.FromSlash(rssStateRelativePath)),
	}, nil
}

// loadProjectEnv 解析项目根目录的 .env 文件，仅当环境变量未被预先设置时才注入，
// 避免覆盖 shell 或 CI 中已存在的值。
func loadProjectEnv() error {
	envPath, err := projectEnvPath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(envPath)
	if err != nil {
		return fmt.Errorf("读取项目根目录 .env 文件失败: %w", err)
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
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
	}
	return scanner.Err()
}

// envOrDefault 返回环境变量值，为空时返回 fallback 默认值。
func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

// projectRoot 定位 ai-daily-report 项目根目录：
// 依次检查当前目录及其父目录是否存在 data.schema.json 标志文件。
func projectRoot() (string, error) {
	current, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("获取当前目录失败: %w", err)
	}
	for _, candidate := range []string{current, filepath.Dir(current)} {
		if _, err := os.Stat(filepath.Join(candidate, "data.schema.json")); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("无法定位 ai-daily-report 项目根目录")
}

// projectEnvPath 返回项目根目录下 .env 文件的绝对路径。
func projectEnvPath() (string, error) {
	root, err := projectRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, ".env"), nil
}
