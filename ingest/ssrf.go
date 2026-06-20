package main

import (
	"fmt"
	"net"
	"syscall"
)

// ssrfControl 挂在 http.Transport 的 Dialer.Control 上：在真正连接前校验 Go
// 已解析出的目标 IP，拒绝 loopback / 私网 / 链路本地 / 未指定 / 组播地址。
// 这样恶意 feed 用图片 URL 把采集器当成 SSRF 跳板去访问内网或云元数据接口
// （如 169.254.169.254）时，会在拨号层被拦下。仅在未配置代理时生效——配置了
// all_proxy 时出站交由代理负责目标限制（否则本层会拦到本地代理本身）。
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
