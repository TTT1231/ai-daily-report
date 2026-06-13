package main

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

// newHTTPClient builds an *http.Client whose Transport enforces TLS 1.2+,
// reuses idle connections, and routes traffic through a discovered VPN/HTTP
// proxy when one is available.
func newHTTPClient(timeout time.Duration, announceProxy bool) *http.Client {
	proxyURL := getProxyURL()
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		MaxIdleConns:        20,
		IdleConnTimeout:     30 * time.Second,
		DisableKeepAlives:   false,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	if proxyURL != nil {
		transport.Proxy = http.ProxyURL(proxyURL)
		if announceProxy {
			fmt.Printf("   网络：使用代理 %s\n", proxyURL)
		}
	}

	return &http.Client{Timeout: timeout, Transport: transport}
}

// getProxyURL resolves the outbound proxy to use. It prefers standard proxy
// environment variables, then falls back to probing common local proxy ports
// (Clash, v2rayN, Shadowsocks, etc.). Returns nil when no proxy is reachable.
func getProxyURL() *url.URL {
	for _, envKey := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		if val := os.Getenv(envKey); val != "" {
			if u, err := url.Parse(val); err == nil {
				return u
			}
		}
	}

	for _, addr := range []string{
		"http://127.0.0.1:7890",
		"http://127.0.0.1:7897",
		"http://127.0.0.1:1080",
		"http://127.0.0.1:10809",
	} {
		u, _ := url.Parse(addr)
		if testPort(u.Host) {
			return u
		}
	}
	return nil
}

// testPort reports whether a TCP connection to host can be opened within a
// short timeout, used to detect whether a local proxy is actually listening.
func testPort(host string) bool {
	conn, err := net.DialTimeout("tcp", host, 2*time.Second)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
