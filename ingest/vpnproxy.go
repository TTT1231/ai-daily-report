package main

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// newHTTPClient builds an *http.Client whose Transport enforces TLS 1.2+,
// reuses idle connections, and routes traffic through all_proxy when configured.
func newHTTPClient(timeout time.Duration, announceProxy bool) *http.Client {
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
