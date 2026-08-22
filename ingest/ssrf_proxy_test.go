package main

// M2 回归测试：「all_proxy 配置静默关闭拨号层 SSRF 守卫」修复后的行为。
//
// 修复前：newHTTPClient(_, _, blockPrivateHosts=true) 在配置 all_proxy 时完全跳过
// 目标校验，feed 控制的图片 URL 可借代理转向内网/回环/云元数据地址。
// 修复后：代理模式下 Transport.Proxy 先本地解析目标主机并逐 IP 校验（ssrfAwareProxyFunc），
// 重定向每一跳也重新校验（ssrfAwareRedirect），直连模式保持拨号层 ssrfControl 不变。

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func makeTinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 320, 320))
	for y := 0; y < 320; y++ {
		for x := 0; x < 320; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 0x33, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

// --- validateRequestHost 单元行为 ---

func TestValidateRequestHostLiteralIPs(t *testing.T) {
	for _, pub := range []string{"1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"} {
		if err := validateRequestHost(pub); err != nil {
			t.Fatalf("validateRequestHost(%s) = %v; want nil（公网地址应放行）", pub, err)
		}
	}
	for _, blocked := range []string{"127.0.0.1", "10.0.0.5", "192.168.1.20", "169.254.169.254", "172.16.0.9", "::1", "fd00::1", "0.0.0.0"} {
		if err := validateRequestHost(blocked); err == nil {
			t.Fatalf("validateRequestHost(%s) = nil; want 拒绝（内网/保留地址）", blocked)
		}
	}
	if err := validateRequestHost(""); err == nil {
		t.Fatalf(`validateRequestHost("") = nil; want error`)
	}
}

func TestValidateRequestHostLocalhostNameResolvesToLoopback(t *testing.T) {
	if err := validateRequestHost("localhost"); err == nil {
		t.Fatalf("localhost 解析到回环地址，应被拒绝")
	}
}

// --- 代理模式下守卫仍生效（M2 核心回归） ---

type m2HitLog struct {
	mu    sync.Mutex
	paths []string
}

func (h *m2HitLog) add(entry string) { h.mu.Lock(); h.paths = append(h.paths, entry); h.mu.Unlock() }
func (h *m2HitLog) snapshot() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.paths...)
}

func TestSSRFGuardSurvivesProxyConfig(t *testing.T) {
	secret := makeTinyPNG(t)

	internalHits := &m2HitLog{}
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		internalHits.add(r.URL.Path)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(secret)
	}))
	defer internal.Close()

	// 「无差别转发」代理：模拟 clash/v2ray——转发任何目标，不做目标 ACL。
	proxyHits := &m2HitLog{}
	plain := &http.Client{Timeout: 10 * time.Second}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyHits.add(r.RequestURI)
		req, err := http.NewRequestWithContext(r.Context(), r.Method, r.RequestURI, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		resp, err := plain.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	}))
	defer proxy.Close()

	origSleep := overlayImageRetrySleep
	overlayImageRetrySleep = func(time.Duration) {}
	defer func() { overlayImageRetrySleep = origSleep }()

	t.Setenv("all_proxy", proxy.URL)

	attackURL := internal.URL + "/latest/meta-data/iam/security-credentials/probe.png"

	// 生产代码路径：downloadVisionOverlayImage 内部请求 blockPrivateHosts=true。
	if _, err := downloadVisionOverlayImage(attackURL, Item{StableID: "m2-regress", Title: "t"}); err == nil {
		t.Fatalf("all_proxy 已配置时对回环目标的抓取应被请求级预检拒绝，但成功了")
	} else if !strings.Contains(err.Error(), "SSRF 校验") {
		t.Fatalf("错误应来自 SSRF 预检，got: %v", err)
	}
	if got := internalHits.snapshot(); len(got) != 0 {
		t.Fatalf("内部目标不应收到任何请求，got: %v", got)
	}
	for _, hit := range proxyHits.snapshot() {
		if strings.Contains(hit, "127.0.0.1") {
			t.Fatalf("代理不应被要求转发回环目标，got: %v", hit)
		}
	}
}

func TestSSRFGuardRevalidatesRedirectTargetsUnderProxy(t *testing.T) {
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("重定向后的回环目标被访问：%s", r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer internal.Close()

	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 首跳目标（公网字面 IP）合法放行；代理响应一个 30x 指向回环内部地址。
		http.Redirect(w, r, internal.URL+"/redirected.png", http.StatusFound)
	}))
	defer proxy.Close()

	t.Setenv("all_proxy", proxy.URL)

	client := newHTTPClient(10*time.Second, false, true)
	resp, err := client.Get("http://93.184.216.34/first.png")
	if err == nil {
		resp.Body.Close()
		t.Fatalf("重定向到回环地址应被拒绝")
	}
	if !strings.Contains(err.Error(), "SSRF 校验") && !strings.Contains(err.Error(), "重定向") {
		t.Fatalf("错误应来自重定向校验，got: %v", err)
	}
}

// 公网目标在代理 + 守卫模式下仍正常工作（字面公网 IP，离线可用）。
func TestPublicHostStillWorksUnderProxyWithGuard(t *testing.T) {
	pngBytes := makeTinyPNG(t)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes)
	}))
	defer proxy.Close()

	t.Setenv("all_proxy", proxy.URL)

	client := newHTTPClient(10*time.Second, false, true)
	resp, err := client.Get("http://93.184.216.34/public-image.png")
	if err != nil {
		t.Fatalf("公网目标经代理请求应成功: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

// 直连模式（无代理）守卫保持原状：拨号层拦截。
func TestSSRFGuardDirectDialStillFires(t *testing.T) {
	t.Setenv("all_proxy", "")

	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("回环目标被直连访问")
	}))
	defer internal.Close()

	client := newHTTPClient(5*time.Second, false, true)
	if _, err := client.Get(internal.URL + "/x.png"); err == nil {
		t.Fatalf("直连回环地址应被拨号层守卫拒绝")
	}
}
