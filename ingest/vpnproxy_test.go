package main

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestGetProxyURLOnlyUsesLowercaseAllProxy(t *testing.T) {
	t.Setenv("all_proxy", "")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:7891")

	proxyURL, err := getProxyURL()
	if err != nil {
		t.Fatalf("getProxyURL error = %v", err)
	}
	if proxyURL != nil {
		t.Fatalf("getProxyURL = %v, want nil", proxyURL)
	}
}

func TestLookupExactEnvDoesNotMatchUppercaseAllProxy(t *testing.T) {
	if value, found := lookupExactEnvFrom([]string{"ALL_PROXY=http://127.0.0.1:7890"}, "all_proxy"); found {
		t.Fatalf("lookupExactEnvFrom matched uppercase ALL_PROXY: %q", value)
	}
}

func TestGetProxyURLReadsAllProxy(t *testing.T) {
	t.Setenv("all_proxy", "socks5://127.0.0.1:7890")

	proxyURL, err := getProxyURL()
	if err != nil {
		t.Fatalf("getProxyURL error = %v", err)
	}
	if got := proxyURL.String(); got != "socks5://127.0.0.1:7890" {
		t.Fatalf("getProxyURL = %q", got)
	}
}

func TestConfiguredInvalidAllProxyDoesNotFallBackToDirectAccess(t *testing.T) {
	t.Setenv("all_proxy", "127.0.0.1:7890")

	client := newHTTPClient(time.Second, false, false)
	transport := client.Transport.(*http.Transport)
	proxyURL, err := transport.Proxy(&http.Request{})
	if err == nil {
		t.Fatalf("Proxy error = nil, proxyURL = %v; want invalid all_proxy error", proxyURL)
	}
}

// newSourceHTTPClient 把「用不用代理」交给每个来源自己决定（proxy:true 强制走 all_proxy，
// 否则直连）。下面四个测试覆盖其全部象限。
func TestNewSourceHTTPClientUsesProxyWhenSourceOptsIn(t *testing.T) {
	t.Setenv("all_proxy", "socks5://127.0.0.1:7890")

	client, err := newSourceHTTPClient(time.Second, RSS2Source{ID: "linuxdo-news", Name: "Linux.do 前沿快讯", Proxy: true})
	if err != nil {
		t.Fatalf("newSourceHTTPClient error = %v", err)
	}
	transport := client.Transport.(*http.Transport)
	proxyURL, err := transport.Proxy(&http.Request{})
	if err != nil {
		t.Fatalf("Proxy error = %v; want configured proxy", err)
	}
	if got := proxyURL.String(); got != "socks5://127.0.0.1:7890" {
		t.Fatalf("Proxy = %q, want socks5://127.0.0.1:7890", got)
	}
}

func TestNewSourceHTTPClientErrorsWhenSourceOptsInButAllProxyMissing(t *testing.T) {
	t.Setenv("all_proxy", "") // 未配置 all_proxy

	_, err := newSourceHTTPClient(time.Second, RSS2Source{ID: "linuxdo-news", Name: "Linux.do 前沿快讯", Proxy: true})
	if err == nil {
		t.Fatalf("want error when source proxy:true but all_proxy unset")
	}
	if !strings.Contains(err.Error(), "linuxdo-news") {
		t.Fatalf("error should name the offending source, got: %v", err)
	}
}

func TestNewSourceHTTPClientErrorsWhenSourceOptsInButAllProxyInvalid(t *testing.T) {
	t.Setenv("all_proxy", "127.0.0.1:7890") // 缺 scheme，getProxyURL 视为无效

	_, err := newSourceHTTPClient(time.Second, RSS2Source{ID: "linuxdo-news", Proxy: true})
	if err == nil {
		t.Fatalf("want error when source proxy:true but all_proxy invalid")
	}
}

func TestNewSourceHTTPClientDirectsWhenSourceOptsOut(t *testing.T) {
	t.Setenv("all_proxy", "socks5://127.0.0.1:7890") // 即使配了 all_proxy……

	client, err := newSourceHTTPClient(time.Second, RSS2Source{ID: "direct-src", Proxy: false})
	if err != nil {
		t.Fatalf("newSourceHTTPClient error = %v", err)
	}
	transport := client.Transport.(*http.Transport)
	if transport.Proxy != nil {
		t.Fatalf("proxy:false source must connect directly, but transport.Proxy is set")
	}
}
