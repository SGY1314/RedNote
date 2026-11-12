package adapter

import (
	"context"
	"strings"
	"testing"
)

func TestMediaRequestPlatformAndSignedURL(t *testing.T) {
	for _, tc := range []struct{ raw, source, want string }{
		{"https://v26-web.douyinvod.com/video/?a=1%2B2&sign=SIGNED", "", "https://www.douyin.com/"},
		{"https://v5-hl-mly-ov.zjcdn.com/video/?a=1%2B2&sign=SIGNED", "", "https://www.douyin.com/"},
		{"https://p3.douyinpic.com/cover.jpg", "", "https://www.douyin.com/"},
		{"https://example.aliyuncs.com/video.mp4", "https://www.douyin.com/video/7662401243356155190?private=DO-NOT-FORWARD", "https://www.douyin.com/"},
		{"https://sns-webpic.xhscdn.com/image.jpg", "https://www.xiaohongshu.com/explore/abc?xsec_token=DO-NOT-FORWARD", "https://www.xiaohongshu.com/"},
		{"https://sns-webpic.xhscdn.com/image.jpg", "https://douyin.com.evil.test/", "https://www.xiaohongshu.com/"},
	} {
		req, err := MediaRequest(context.Background(), tc.raw, tc.source)
		if err != nil {
			t.Fatal(err)
		}
		if req.URL.String() != tc.raw || req.Header.Get("Referer") != tc.want {
			t.Fatalf("URL or source changed: %s", req.Header.Get("Referer"))
		}
		if req.Header.Get("Cookie") != "" || strings.Contains(req.Header.Get("Referer"), "DO-NOT-FORWARD") {
			t.Fatal("credential leak")
		}
	}
	if _, err := MediaRequest(context.Background(), "https://douyinvod.com.evil.test/video.mp4", ""); err == nil {
		t.Fatal("unsafe media accepted")
	}
}

func TestMediaErrorsDoNotSuggestModelOrCookieConfiguration(t *testing.T) {
	for _, status := range []int{401, 403, 404, 410, 429, 500} {
		msg := MediaStatusError(status).Error()
		if strings.Contains(msg, "模型") || strings.Contains(msg, "Cookie") {
			t.Fatal(msg)
		}
		if !strings.Contains(msg, "HTTP") {
			t.Fatal("missing stage/status")
		}
	}
}
