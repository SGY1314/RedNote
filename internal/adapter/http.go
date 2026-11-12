package adapter

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func PublicIP(ip net.IP) bool {
	return ip != nil && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified() && !ip.IsMulticast() && ip.IsGlobalUnicast() && !strings.HasPrefix(ip.String(), "100.100.")
}
func AllowedURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return errors.New("无效的下载地址")
	}
	if u.Port() != "" && u.Port() != "443" && u.Port() != "80" {
		return errors.New("下载端口不允许")
	}
	h := strings.ToLower(u.Hostname())
	// Exact CDN host returned by collected Douyin videos. Do not allow the
	// entire zjcdn.com domain; redirects and DNS/IP checks still apply.
	if u.Scheme == "https" && (u.Port() == "" || u.Port() == "443") && h == "v5-hl-mly-ov.zjcdn.com" {
		return nil
	}
	for _, suffix := range []string{"xiaohongshu.com", "xhslink.com", "xhslink.cn", "xhscdn.com", "xiaohongshu.net", "aliyuncs.com", "ali-cdn.com", "douyin.com", "douyinvod.com", "douyinpic.com", "byteimg.com", "ibytedtos.com", "bytedance.com", "pstatp.com"} {
		if h == suffix || strings.HasSuffix(h, "."+suffix) {
			return nil
		}
	}
	return errors.New("下载域名不在允许列表")
}
func MediaClient() *http.Client {
	tr := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		h, p, e := net.SplitHostPort(addr)
		if e != nil {
			return nil, e
		}
		ips, e := net.DefaultResolver.LookupIPAddr(ctx, h)
		if e != nil {
			return nil, e
		}
		if len(ips) == 0 {
			return nil, errors.New("DNS 无结果")
		}
		for _, ip := range ips {
			if !PublicIP(ip.IP) {
				return nil, errors.New("下载目标地址不允许")
			}
		}
		d := net.Dialer{Timeout: 20 * time.Second}
		return d.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), p))
	}, ResponseHeaderTimeout: 30 * time.Second}
	return &http.Client{Transport: tr, Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 {
			return errors.New("重定向次数过多")
		}
		return AllowedURL(req.URL.String())
	}}
}
func ServiceURL(raw string, ws bool) error {
	u, e := url.Parse(raw)
	if e != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("服务地址无效")
	}
	if u.Scheme == "https" || ws && u.Scheme == "wss" {
		return nil
	}
	if (u.Scheme == "http" || ws && u.Scheme == "ws") && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost") {
		return nil
	}
	return errors.New("远程服务必须使用 HTTPS / WSS")
}
func StatusError(status int) error {
	switch status {
	case 401:
		return errors.New("鉴权失败，请检查密钥或 Cookie")
	case 403:
		return errors.New("服务拒绝访问，请检查模型权限或 Cookie")
	case 429:
		return errors.New("请求限流，请稍后手动重试")
	}
	return fmt.Errorf("外部服务返回 HTTP %d，请检查服务配置", status)
}
