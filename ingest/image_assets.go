package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
	"time"
)

const maxOverlayImageBytes int64 = 5 * 1024 * 1024
const maxOverlayImageDownloadAttempts = 3

var overlayImageRetrySleep = time.Sleep

type downloadedOverlayImage struct {
	Path   string
	Width  int
	Height int
}

func downloadVisionOverlayImage(imageURL string, item Item) (downloadedOverlayImage, error) {
	client := newHTTPClient(defaultFeedRequestTimeout, false, true)
	data, extension, err := fetchOverlayImage(client, imageURL, item.Link)
	if err != nil {
		return downloadedOverlayImage{}, err
	}
	width, height := decodeOverlayImageDimensions(data)
	if isLikelyDecorativeCandidateImage(width, height) {
		return downloadedOverlayImage{}, fmt.Errorf("图片疑似头像、Logo 或小图标（%dx%d），跳过该 overlay", width, height)
	}
	root, err := projectRoot()
	if err != nil {
		return downloadedOverlayImage{}, err
	}
	return saveOverlayImage(data, overlayImageFilename(item, imageURL, extension), root)
}

// fetchOverlayImage 下载远程图片字节，校验类型与大小，返回字节内容与最终落盘扩展名（.png/.jpg/.webp）。
// client 由调用方注入：生产传带 SSRF 防护的 newHTTPClient(defaultFeedRequestTimeout,false,true)，
// 测试传放行 loopback 的 newHTTPClient(defaultFeedRequestTimeout,false,false)（SSRF 防护会拦 127.0.0.1，httptest 需要放行）。
// refererLink 非空时作为 Referer 发送，用于绕过部分图床的防盗链。
func fetchOverlayImage(client *http.Client, imageURL, refererLink string) ([]byte, string, error) {
	var lastErr error
	for attempt := 1; attempt <= maxOverlayImageDownloadAttempts; attempt++ {
		data, extension, err := fetchOverlayImageOnce(client, imageURL, refererLink)
		if err == nil {
			return data, extension, nil
		}
		lastErr = err

		var he *httpError
		retryable := errors.As(err, &he) && he.retryable
		if !retryable || attempt == maxOverlayImageDownloadAttempts {
			break
		}
		wait := he.retryAfter
		if wait <= 0 {
			wait = time.Duration(attempt*2) * time.Second
		}
		fmt.Printf("   图片重试：%s 第 %d 次，等待 %v\n", imageURL, attempt, wait)
		overlayImageRetrySleep(wait)
	}
	return nil, "", lastErr
}

func fetchOverlayImageOnce(client *http.Client, imageURL, refererLink string) ([]byte, string, error) {
	request, err := http.NewRequest(http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("创建图片请求失败: %w", err)
	}
	request.Header.Set("User-Agent", "ai-daily-report-rss/1.0")
	if strings.TrimSpace(refererLink) != "" {
		request.Header.Set("Referer", refererLink)
	}

	response, err := client.Do(request)
	if err != nil {
		return nil, "", &httpError{message: "下载图片失败: " + err.Error(), retryable: true}
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode == http.StatusTooManyRequests:
		return nil, "", &httpError{
			message:    "下载图片 HTTP 429 限流",
			retryable:  true,
			retryAfter: parseRetryAfter(response),
		}
	case response.StatusCode >= 500:
		return nil, "", &httpError{
			message:    fmt.Sprintf("下载图片 HTTP 状态码: %d", response.StatusCode),
			retryable:  true,
			retryAfter: parseRetryAfter(response),
		}
	case response.StatusCode != http.StatusOK:
		return nil, "", fmt.Errorf("下载图片 HTTP 状态码: %d", response.StatusCode)
	}
	contentType := mediaType(response.Header.Get("Content-Type"))
	contentExtension := supportedOverlayImageExtensionFromContentType(contentType)
	extension := supportedOverlayImageExtensionFromURL(imageURL)
	if extension == "" {
		extension = contentExtension
	}
	if extension == "" {
		return nil, "", fmt.Errorf("不支持的图片格式: %s", firstNonEmpty(contentType, imageURL))
	}
	if contentExtension == "" && contentType != "" && contentType != "application/octet-stream" {
		return nil, "", fmt.Errorf("响应不是可用图片类型: %s", contentType)
	}
	if response.ContentLength > maxOverlayImageBytes {
		return nil, "", fmt.Errorf("图片过大: %d bytes", response.ContentLength)
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, maxOverlayImageBytes+1))
	if err != nil {
		return nil, "", &httpError{message: "读取图片失败: " + err.Error(), retryable: true}
	}
	if int64(len(data)) > maxOverlayImageBytes {
		return nil, "", fmt.Errorf("图片超过 %d bytes", maxOverlayImageBytes)
	}
	return data, extension, nil
}

// saveOverlayImage 把字节写入 <rootDir>/data-scheme/images/<filename>（按需建目录），
// 解码尺寸后返回相对路径（images/<filename>）与宽高。无法解码出正尺寸时拒绝写盘，
// 避免把 0×0 的 overlay 写进 data.json 导致渲染层除零或异常缩放。
func saveOverlayImage(data []byte, filename, rootDir string) (downloadedOverlayImage, error) {
	width, height := decodeOverlayImageDimensions(data)
	if width <= 0 || height <= 0 {
		return downloadedOverlayImage{}, fmt.Errorf("无法解码图片尺寸（可能为不支持的格式或损坏图），跳过该 overlay")
	}
	relativePath := "images/" + filename
	absolutePath := filepath.Join(rootDir, "data-scheme", filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		return downloadedOverlayImage{}, fmt.Errorf("创建图片目录失败: %w", err)
	}
	if err := os.WriteFile(absolutePath, data, 0o644); err != nil {
		return downloadedOverlayImage{}, fmt.Errorf("写入图片失败: %w", err)
	}
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
