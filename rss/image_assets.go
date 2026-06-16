package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxOverlayImageBytes int64 = 5 * 1024 * 1024

type downloadedOverlayImage struct {
	Path   string
	Width  int
	Height int
}

func downloadVisionOverlayImage(imageURL string, item Item) (downloadedOverlayImage, error) {
	extension := supportedOverlayImageExtensionFromURL(imageURL)
	client := newHTTPClient(defaultFeedRequestTimeout, false)
	request, err := http.NewRequest(http.MethodGet, imageURL, nil)
	if err != nil {
		return downloadedOverlayImage{}, fmt.Errorf("创建图片请求失败: %w", err)
	}
	request.Header.Set("User-Agent", "ai-daily-report-rss/1.0")
	if strings.TrimSpace(item.Link) != "" {
		request.Header.Set("Referer", item.Link)
	}

	response, err := client.Do(request)
	if err != nil {
		return downloadedOverlayImage{}, fmt.Errorf("下载图片失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return downloadedOverlayImage{}, fmt.Errorf("下载图片 HTTP 状态码: %d", response.StatusCode)
	}
	contentType := mediaType(response.Header.Get("Content-Type"))
	contentExtension := supportedOverlayImageExtensionFromContentType(contentType)
	if extension == "" {
		extension = contentExtension
	}
	if extension == "" {
		return downloadedOverlayImage{}, fmt.Errorf("不支持的图片格式: %s", firstNonEmpty(contentType, imageURL))
	}
	if contentExtension == "" && contentType != "" && contentType != "application/octet-stream" {
		return downloadedOverlayImage{}, fmt.Errorf("响应不是可用图片类型: %s", contentType)
	}
	if response.ContentLength > maxOverlayImageBytes {
		return downloadedOverlayImage{}, fmt.Errorf("图片过大: %d bytes", response.ContentLength)
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, maxOverlayImageBytes+1))
	if err != nil {
		return downloadedOverlayImage{}, fmt.Errorf("读取图片失败: %w", err)
	}
	if int64(len(data)) > maxOverlayImageBytes {
		return downloadedOverlayImage{}, fmt.Errorf("图片超过 %d bytes", maxOverlayImageBytes)
	}

	relativePath := "images/" + overlayImageFilename(item, imageURL, extension)
	root, err := projectRoot()
	if err != nil {
		return downloadedOverlayImage{}, err
	}
	absolutePath := filepath.Join(root, "data-scheme", filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		return downloadedOverlayImage{}, fmt.Errorf("创建图片目录失败: %w", err)
	}
	if err := os.WriteFile(absolutePath, data, 0o644); err != nil {
		return downloadedOverlayImage{}, fmt.Errorf("写入图片失败: %w", err)
	}
	width, height := decodeOverlayImageDimensions(data)
	return downloadedOverlayImage{Path: relativePath, Width: width, Height: height}, nil
}

func decodeOverlayImageDimensions(data []byte) (int, int) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err == nil && config.Width > 0 && config.Height > 0 {
		return config.Width, config.Height
	}
	return decodeWebPDimensions(data)
}

func decodeWebPDimensions(data []byte) (int, int) {
	if len(data) < 30 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0, 0
	}
	for offset := 12; offset+8 <= len(data); {
		chunk := string(data[offset : offset+4])
		size := int(littleEndianUint32(data[offset+4 : offset+8]))
		start := offset + 8
		end := start + size
		if end > len(data) {
			return 0, 0
		}
		payload := data[start:end]
		switch chunk {
		case "VP8X":
			if len(payload) >= 10 {
				return 1 + littleEndianUint24(payload[4:7]), 1 + littleEndianUint24(payload[7:10])
			}
		case "VP8 ":
			if len(payload) >= 10 && payload[3] == 0x9d && payload[4] == 0x01 && payload[5] == 0x2a {
				width := int(littleEndianUint16(payload[6:8]) & 0x3fff)
				height := int(littleEndianUint16(payload[8:10]) & 0x3fff)
				return width, height
			}
		case "VP8L":
			if len(payload) >= 5 && payload[0] == 0x2f {
				width := 1 + int(payload[1]) + int(payload[2]&0x3f)<<8
				height := 1 + int(payload[2]>>6) + int(payload[3])<<2 + int(payload[4]&0x0f)<<10
				return width, height
			}
		}
		offset = end
		if offset%2 == 1 {
			offset++
		}
	}
	return 0, 0
}

func littleEndianUint16(data []byte) uint16 {
	return uint16(data[0]) | uint16(data[1])<<8
}

func littleEndianUint24(data []byte) int {
	return int(data[0]) | int(data[1])<<8 | int(data[2])<<16
}

func littleEndianUint32(data []byte) uint32 {
	return uint32(data[0]) | uint32(data[1])<<8 | uint32(data[2])<<16 | uint32(data[3])<<24
}

func mediaType(value string) string {
	parsed, _, err := mime.ParseMediaType(strings.TrimSpace(value))
	if err != nil {
		return strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	}
	return strings.ToLower(parsed)
}

func supportedOverlayImageExtensionFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	sourcePath := rawURL
	if err == nil {
		sourcePath = parsed.Path
	}
	switch strings.ToLower(path.Ext(sourcePath)) {
	case ".png":
		return ".png"
	case ".jpg", ".jpeg":
		return ".jpg"
	case ".webp":
		return ".webp"
	default:
		return ""
	}
}

func supportedOverlayImageExtensionFromContentType(contentType string) string {
	switch mediaType(contentType) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

func overlayImageFilename(item Item, imageURL, extension string) string {
	base := sanitizeIdentifier(firstNonEmpty(item.StableID, item.CanonicalID, sourceStoryID(item)))
	if base == "" {
		base = "image"
	}
	hash := sha256.Sum256([]byte(imageURL))
	return fmt.Sprintf("%s-%s%s", base, hex.EncodeToString(hash[:])[:10], extension)
}
