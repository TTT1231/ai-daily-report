package main

import (
	"net/http"
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
