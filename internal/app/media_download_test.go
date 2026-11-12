package app

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
)

type mediaTransport func(*http.Request) (*http.Response, error)

func (f mediaTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDownloadMediaUsesPlatformSource(t *testing.T) {
	a := testApp(t)
	fixture := sampleImage(t, a)
	body, err := os.ReadFile(filepath.Join(a.Config.DataDir, "media", fixture.Path))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, url, source, want string }{
		{"douyin cover", "https://p3.douyinpic.com/cover.png", "https://www.douyin.com/video/7662401243356155190", "https://www.douyin.com/"},
		{"douyin legacy record", "https://p3.douyinpic.com/cover.png", "", "https://www.douyin.com/"},
		{"douyin collected CDN", "https://v5-hl-mly-ov.zjcdn.com/media/?sign=SIGNED", "", "https://www.douyin.com/"},
		{"xhs regression", "https://sns-webpic.xhscdn.com/cover.png", "https://www.xiaohongshu.com/explore/abc", "https://www.xiaohongshu.com/"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: mediaTransport(func(req *http.Request) (*http.Response, error) {
				status := http.StatusOK
				if req.Header.Get("Referer") != tc.want {
					status = http.StatusForbidden
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}, nil
			})}
			asset := domain.Asset{ID: ID(), Kind: "image", RemoteURL: tc.url, Status: "failed", Error: "old 403"}
			if err := a.downloadMedia(&asset, tc.source, client); err != nil {
				t.Fatal(err)
			}
			if asset.Status != "ready" || asset.Error != "" || asset.Size != int64(len(body)) || asset.Path == "" {
				t.Fatalf("media not persisted: %+v", asset)
			}
		})
	}
}

func TestDownloadMedia403DoesNotCreateAFileOrSuggestAIConfiguration(t *testing.T) {
	a := testApp(t)
	client := &http.Client{Transport: mediaTransport(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader("denied")), Header: make(http.Header)}, nil
	})}
	asset := domain.Asset{ID: ID(), Kind: "video", RemoteURL: "https://v26-web.douyinvod.com/video/", Status: "pending"}
	err := a.downloadMedia(&asset, "https://www.douyin.com/video/7662401243356155190", client)
	if err == nil || !strings.Contains(err.Error(), "403") || strings.Contains(err.Error(), "模型") || strings.Contains(err.Error(), "Cookie") {
		t.Fatalf("unexpected error: %v", err)
	}
	if asset.Status == "ready" || asset.Path != "" {
		t.Fatal("failed download marked ready")
	}
	entries, _ := os.ReadDir(filepath.Join(a.Config.DataDir, "media"))
	if len(entries) != 0 {
		t.Fatal("failed download created media")
	}
}
