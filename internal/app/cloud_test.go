package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestCloudOriginIsExplicitAndShutdownDisabled(t *testing.T) {
	a := testApp(t)
	a.Config.PublicOrigin = "https://example.test:8443"
	for _, tc := range []struct {
		origin string
		status int
	}{{"https://example.test:8443", 200}, {"https://evil.test", 403}, {"http://example.test:8443", 403}, {"https://example.test:8443/path", 403}, {"http://127.0.0.1:8080", 200}} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8080/api/v1/health", nil)
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		a.Router().ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("origin %s: %d", tc.origin, w.Code)
		}
	}
	request(t, a, "POST", "/shutdown", nil, 403)
	cfg := a.Config
	cfg.PublicOrigin = "http://public.test"
	if app, e := New(cfg); e == nil {
		app.Close()
		t.Fatal("plaintext public origin accepted")
	}
}

func TestDeferredCloudBrowserOperationsAreBlocked(t *testing.T) {
	a := testApp(t)
	a.Config.BrowserDisabled = true
	for _, path := range []string{"/publisher/status", "/publisher/qrcode", "/platforms/douyin/login", "/publications/missing/publish", "/publications/missing/publish-prepare", "/post-monitor/sync"} {
		request(t, a, "POST", path, nil, 503)
	}
	request(t, a, "GET", "/assets", nil, 200)
	request(t, a, "GET", "/rewrites", nil, 200)
}

func TestCloudDouyinReadOnlyCollectionAllowsExistingWorkerButBlocksPublishing(t *testing.T) {
	a := testApp(t)
	a.Config.BrowserDisabled = true
	called := false
	a.douyinTest = func(_ context.Context, op string, _ any, result any) error {
		if op != "collect" {
			t.Fatalf("unexpected cloud operation %s", op)
		}
		called = true
		payload := map[string]any{"作品ID": "7123456789012345678", "作品类型": "视频", "作品标题": "公开视频", "作品描述": "可参考的内容", "下载地址": []string{"https://v.douyinvod.com/test.mp4"}, "封面地址": "https://p3.douyinpic.com/cover.png"}
		b, _ := json.Marshal(payload)
		return json.Unmarshal(b, result)
	}
	response := decode[struct {
		Items []struct {
			JobID    string `json:"job_id"`
			Platform string `json:"platform"`
		} `json:"items"`
	}](t, request(t, a, "POST", "/collections", map[string]string{"text": "https://www.douyin.com/video/7123456789012345678"}, 202))
	if len(response.Items) != 1 || response.Items[0].Platform != "douyin" {
		t.Fatal("collection response lost platform")
	}
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", response.Items[0].JobID)
	if _, err := a.runCollect(job); err != nil || !called {
		t.Fatal("cloud collection blocked", err)
	}
	if err := a.douyinCall(context.Background(), "prepare", nil, nil); err == nil {
		t.Fatal("cloud publishing enabled")
	}
}
