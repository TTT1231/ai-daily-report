package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// readJSONC 读取带 // 和 /* */ 注释的 JSON 配置文件。
func readJSONC(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取配置 %s 失败: %w", path, err)
	}
	cleaned, err := stripJSONComments(data)
	if err != nil {
		return fmt.Errorf("解析配置 %s 的注释失败: %w", path, err)
	}
	if err := json.Unmarshal(cleaned, target); err != nil {
		return fmt.Errorf("解析配置 %s 失败: %w", path, err)
	}
	return nil
}

// stripJSONComments 删除字符串外的行注释和块注释，同时保留换行以便 JSON 错误位置仍容易定位。
func stripJSONComments(input []byte) ([]byte, error) {
	output := make([]byte, 0, len(input))
	inString := false
	escaped := false
	for i := 0; i < len(input); i++ {
		current := input[i]
		if inString {
			output = append(output, current)
			if escaped {
				escaped = false
			} else if current == '\\' {
				escaped = true
			} else if current == '"' {
				inString = false
			}
			continue
		}
		if current == '"' {
			inString = true
			output = append(output, current)
			continue
		}
		if current != '/' || i+1 >= len(input) {
			output = append(output, current)
			continue
		}
		switch input[i+1] {
		case '/':
			i += 2
			for ; i < len(input) && input[i] != '\n'; i++ {
			}
			if i < len(input) {
				output = append(output, '\n')
			}
		case '*':
			i += 2
			closed := false
			for ; i < len(input); i++ {
				if input[i] == '\n' {
					output = append(output, '\n')
				}
				if input[i] == '*' && i+1 < len(input) && input[i+1] == '/' {
					i++
					closed = true
					break
				}
			}
			if !closed {
				return nil, fmt.Errorf("块注释未闭合")
			}
		default:
			output = append(output, current)
		}
	}
	if inString {
		return nil, fmt.Errorf("字符串未闭合")
	}
	return output, nil
}
