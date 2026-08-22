package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
)

// ssrfControl 挂在 http.Transport 的 Dialer.Control 上：在真正连接前校验 Go
// 已解析出的目标 IP，拒绝 loopback / 私网 / 链路本地 / 未指定 / 组播地址。
// 这样恶意 feed 用图片 URL 把采集器当成 SSRF 跳板去访问内网或云元数据接口
// （如 169.254.169.254）时，会在拨号层被拦下。仅在未配置代理时生效——配置了
// all_proxy 时拨号目标是代理本身，本层改由请求级预检（validateRequestHost）接管。
func ssrfControl(network, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("SSRF 校验：无法解析地址 %s", address)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("SSRF 校验：非 IP 地址 %s", host)
	}
	if isBlockedIP(ip) {
		return fmt.Errorf("SSRF 校验：拒绝访问内网/保留地址 %s", ip)
	}
	return nil
}

// isBlockedIP 报告 IP 是否属于不应被远程图片抓取访问的保留网段。
func isBlockedIP(ip net.IP) bool {
	return ip == nil ||
		ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsMulticast()
}

// validateRequestHost 在把请求交给代理前，用本地 DNS 解析目标主机并校验所有解析结果。
// 配置 all_proxy 后 net/http 的拨号层只能看到代理地址（socks5/socks5h 的目标域名
// 一律由代理侧解析，http 代理 CONNECT 也是代理去连目标），拨号层 SSRF 守卫因此失效；
// 改在请求层预检目标，让「目标校验」与「路由方式」解耦（M2 修复）。
func validateRequestHost(host string) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return errors.New("SSRF 校验：请求缺少目标主机")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			return fmt.Errorf("SSRF 校验：拒绝访问内网/保留地址 %s", ip)
		}
		return nil
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("SSRF 校验：无法解析目标主机 %s: %w", host, err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("SSRF 校验：目标主机 %s 未解析到任何地址", host)
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return fmt.Errorf("SSRF 校验：目标主机 %s 解析到内网/保留地址 %s", host, ip)
		}
	}
	return nil
}

// ssrfAwareProxyFunc 把 http.ProxyURL 包一层：返回代理地址前先校验本次请求的目标主机。
// 返回错误会让请求失败且不会回退直连，与「代理配置错误必须失败」的既有语义一致。
func ssrfAwareProxyFunc(proxyURL *url.URL) func(*http.Request) (*url.URL, error) {
	return func(req *http.Request) (*url.URL, error) {
		if req.URL == nil {
			return nil, errors.New("SSRF 校验：请求缺少 URL")
		}
		if err := validateRequestHost(req.URL.Hostname()); err != nil {
			return nil, err
		}
		return proxyURL, nil
	}
}

// ssrfAwareRedirect 每一跳重定向都重新校验目标主机：feed 图片 URL 的最终落点由
// 攻击者响应控制，30x 链可以把首跳合法的 URL 引到内网/元数据地址。
func ssrfAwareRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return fmt.Errorf("连续重定向超过 10 次")
	}
	if req.URL == nil {
		return errors.New("SSRF 校验：重定向缺少 URL")
	}
	return validateRequestHost(req.URL.Hostname())
}
