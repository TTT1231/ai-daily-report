package main

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// newHTTPClient builds an *http.Client whose Transport enforces TLS 1.2+,
// reuses idle connections, and routes traffic through all_proxy when configured.
// blockPrivateHosts enables an SSRF guard at the dial layer that rejects
// loopback/private/link-local destinations; use it for outbound requests whose
// URL comes from untrusted feed content (e.g. remote overlay images).
func newHTTPClient(timeout time.Duration, announceProxy, blockPrivateHosts bool) *http.Client {
	proxyURL, proxyErr := getProxyURL()
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		MaxIdleConns:        20,
		IdleConnTimeout:     30 * time.Second,
		DisableKeepAlives:   false,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	if proxyErr != nil {
		// A configured proxy is mandatory. Returning its validation error from
		// Transport.Proxy prevents requests from silently falling back to direct access.
		transport.Proxy = func(*http.Request) (*url.URL, error) {
			return nil, proxyErr
		}
	} else if proxyURL != nil {
		transport.Proxy = http.ProxyURL(proxyURL)
		if announceProxy {
			fmt.Printf("   网络：使用 all_proxy %s\n", proxyURL)
		}
	} else if blockPrivateHosts {
		// No proxy: enforce the SSRF guard at the dial layer so a malicious
		// image URL cannot reach internal/cloud-metadata hosts. With a proxy
		// configured the dial targets the proxy itself, so we skip the guard
		// and let the proxy own destination policy.
		transport.DialContext = (&net.Dialer{
			Timeout: 30 * time.Second,
			Control: ssrfControl,
		}).DialContext
	}

	return &http.Client{Timeout: timeout, Transport: transport}
}

// getProxyURL returns the optional all_proxy configuration. No other proxy
// variables or local proxy ports are considered.
func getProxyURL() (*url.URL, error) {
	configured, exists := lookupExactEnv("all_proxy")
	value := strings.TrimSpace(configured)
	if !exists {
		return nil, nil
	}
	if value == "" {
		return nil, nil
	}

	proxyURL, err := url.Parse(value)
	if err != nil {
		return nil, fmt.Errorf("all_proxy 不是有效代理地址: %w", err)
	}
	switch strings.ToLower(proxyURL.Scheme) {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, fmt.Errorf("all_proxy 仅支持 http、https、socks5 或 socks5h 协议")
	}
	if proxyURL.Host == "" {
		return nil, fmt.Errorf("all_proxy 必须包含代理主机和端口")
	}
	return proxyURL, nil
}

// newSourceHTTPClient 构建某个 RSS 来源专属的 *http.Client，把「用不用代理」的决定权
// 交给每个来源自己（取代过去阶段级一刀切）：
//   - source.Proxy == true：强制走 .env 的 all_proxy。配了就用；未配或无效则返回明确错误
//     （含来源 ID），绝不静默回退直连——用于 linux.do 等被 Cloudflare 防护、直连必败的来源。
//   - source.Proxy == false：直连，不读 all_proxy。来源 URL 来自用户可信的 sources.jsonc，
//     故不加 SSRF 守卫（SSRF 仅用于来自不可信 feed 内容的图片 URL）。
//
// 与 newHTTPClient 的区别：newHTTPClient 是「配了 all_proxy 就走」的自动策略，供图片下载、
// AI 模型请求等非按源场景使用；本函数按来源显式决策。
func newSourceHTTPClient(timeout time.Duration, source RSS2Source) (*http.Client, error) {
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		MaxIdleConns:        20,
		IdleConnTimeout:     30 * time.Second,
		DisableKeepAlives:   false,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	if source.Proxy {
		proxyURL, err := getProxyURL()
		if err != nil {
			return nil, fmt.Errorf("来源 %s 标记 proxy:true，但 all_proxy 无效: %w", source.ID, err)
		}
		if proxyURL == nil {
			return nil, fmt.Errorf("来源 %s 标记 proxy:true，但 .env 未配置 all_proxy", source.ID)
		}
		transport.Proxy = http.ProxyURL(proxyURL)
		fmt.Printf("   网络：%s 使用 all_proxy %s\n", source.Name, proxyURL)
	}
	return &http.Client{Timeout: timeout, Transport: transport}, nil
}
