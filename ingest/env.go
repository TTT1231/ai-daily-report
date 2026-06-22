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
	baseURL := strings.TrimSpace(os.Getenv("AI_BASE_URL"))
	if baseURL == "" {
		return AppConfig{}, fmt.Errorf("请在项目根目录 .env 中填写有效的 AI_BASE_URL")
	}
	model := strings.TrimSpace(os.Getenv("AI_MODEL"))
	if model == "" {
		return AppConfig{}, fmt.Errorf("请在项目根目录 .env 中填写有效的 AI_MODEL")
	}
	sourcesPath := configPath(root, defaultSourcesPath)
	sources, err := loadSources(sourcesPath)
	if err != nil {
		return AppConfig{}, err
	}
	preferencesPath := configPath(root, defaultPreferencesPath)
	preferences, err := loadPreferences(preferencesPath)
	if err != nil {
		return AppConfig{}, err
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
			BaseURL:   baseURL,
			Model:     model,
			ExtraBody: extraBody,
		},
		Sources:     sources,
		Preferences: preferences,
		Lookback:    rssLookback,
		StatePath:   filepath.Join(root, filepath.FromSlash(rssStateRelativePath)),
	}, nil
}

func configPath(root, configured string) string {
	configured = filepath.FromSlash(strings.TrimSpace(configured))
	if filepath.IsAbs(configured) {
		return configured
	}
	return filepath.Join(root, configured)
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
		_, exactKeyExists := lookupExactEnv(key)
		if key == "all_proxy" && !exactKeyExists {
			// Windows environment keys are case-insensitive and may retain the
			// casing of an existing ALL_PROXY entry. Recreate it with the exact
			// lowercase name required by this project.
			_ = os.Unsetenv(key)
			_ = os.Setenv(key, value)
		} else if key != "all_proxy" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

// lookupExactEnv reads an environment variable with case-sensitive key matching.
// This is needed for all_proxy on Windows, where os.Getenv also matches ALL_PROXY.
func lookupExactEnv(name string) (string, bool) {
	return lookupExactEnvFrom(os.Environ(), name)
}

func lookupExactEnvFrom(environ []string, name string) (string, bool) {
	for _, entry := range environ {
		key, value, found := strings.Cut(entry, "=")
		if found && key == name {
			return value, true
		}
	}
	return "", false
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
