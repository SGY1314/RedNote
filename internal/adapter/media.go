package adapter

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// MediaRequest keeps signed media URLs intact. Only a platform origin is sent
// as Referer; share tokens, credentials and full source URLs are never forwarded.
func MediaRequest(ctx context.Context, raw, source string) (*http.Request, error) {
	if err := AllowedURL(raw); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, fmt.Errorf("无效的媒体下载地址")
	}
	referer := "https://www.xiaohongshu.com/"
	if strings.EqualFold(req.URL.Hostname(), "v5-hl-mly-ov.zjcdn.com") {
		referer = "https://www.douyin.com/"
	}
	matches := func(host, domain string) bool { return host == domain || strings.HasSuffix(host, "."+domain) }
	for _, domain := range []string{"douyin.com", "douyinvod.com", "douyinpic.com", "byteimg.com", "ibytedtos.com", "pstatp.com"} {
		if matches(strings.ToLower(req.URL.Hostname()), domain) {
			referer = "https://www.douyin.com/"
			break
		}
	}
	if u, e := url.Parse(source); e == nil && u.User == nil && (u.Scheme == "https" || u.Scheme == "http") {
		if matches(strings.ToLower(u.Hostname()), "douyin.com") {
			referer = "https://www.douyin.com/"
		}
	}
	req.Header.Set("Referer", referer)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	return req, nil
}

func MediaStatusError(status int) error {
	switch status {
	case 401, 403:
		return fmt.Errorf("媒体服务器拒绝下载（HTTP %d）。请先重试下载；若仍失败，请在笔记详情重新采集以更新媒体地址", status)
	case 404, 410:
		return fmt.Errorf("媒体地址已失效或文件不可用（HTTP %d），请在笔记详情重新采集", status)
	case 429:
		return fmt.Errorf("媒体下载被限流（HTTP 429），请稍后重试")
	default:
		return fmt.Errorf("媒体下载返回 HTTP %d，请稍后重试", status)
	}
}
