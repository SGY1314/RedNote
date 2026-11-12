package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func testApp(t *testing.T) *App {
	t.Helper()
	a, e := New(Config{Listen: "127.0.0.1:8080", DataDir: t.TempDir(), CollectorURL: "http://127.0.0.1:5556", WebDir: t.TempDir()})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(a.Close)
	return a
}
func request(t *testing.T, a *App, method, path string, body any, code int) []byte {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(method, "http://127.0.0.1:8080/api/v1"+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", a.CSRF)
	w := httptest.NewRecorder()
	a.Router().ServeHTTP(w, req)
	if w.Code != code {
		t.Fatalf("%s %s: expected %d, got %d: %s", method, path, code, w.Code, w.Body.String())
	}
	return w.Body.Bytes()
}
func decode[T any](t *testing.T, b []byte) T {
	t.Helper()
	var v T
	if e := json.Unmarshal(b, &v); e != nil {
		t.Fatal(e)
	}
	return v
}
func sampleImage(t *testing.T, a *App) domain.Asset {
	t.Helper()
	im := image.NewRGBA(image.Rect(0, 0, 32, 48))
	im.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var b bytes.Buffer
	png.Encode(&b, im)
	v := domain.Asset{ID: ID(), Name: "自己的图片.png", Source: "upload", CreatedAt: Now()}
	if e := a.ingest(&b, &v); e != nil {
		t.Fatal(e)
	}
	if e := store.Put(a.Store.DB, "assets", v.ID, v); e != nil {
		t.Fatal(e)
	}
	return v
}
func TestManualWorkflowSnapshotAndPublishWithoutExport(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "周末创作"}, 201))
	asset := sampleImage(t, a)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{asset.ID}}, 200)
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "最初标题", "body": "自己的真实体验。", "topics": []string{"生活"}}, 201))
	req := map[string]any{"version_id": v.ID, "kind": "image", "asset_ids": []string{asset.ID}}
	request(t, a, "POST", "/publications", req, 409)
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", map[string]any{}, 200)
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", req, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "后来修改", "body": "这是不同文案", "topics": []string{}}, 201)
	v2, _ := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	if v2.Title != "最初标题" || v2.Status != "confirmed" {
		t.Fatal("confirmed version mutated")
	}
	request(t, a, "POST", "/publications/"+pub.ID+"/export", nil, 410)
	request(t, a, "GET", "/publications/"+pub.ID+"/package", nil, 410)
	job := newJob("export", pub.ID, nil)
	if _, err := a.runExport(job); err == nil {
		t.Fatal("removed export still executes")
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 0 {
		t.Fatal("removed export enqueued a job")
	}
	got, _ := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if got.PublishedAt != "" || got.Title != "最初标题" || len(got.ExportedAt) != 0 {
		t.Fatal("snapshot mutated")
	}
	job.State = "failed"
	store.Put(a.Store.DB, "jobs", job.ID, job)
	request(t, a, "POST", "/jobs/"+job.ID+"/retry", nil, 410)
	request(t, a, "PATCH", "/publications/"+pub.ID, map[string]string{"published_at": time.Now().UTC().Format(time.RFC3339), "published_url": "https://www.xiaohongshu.com/explore/abc123"}, 200)
	got, _ = store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if got.PublishedAt == "" {
		t.Fatal("manual publication record missing")
	}
}
func TestBoundaryAndRange(t *testing.T) {
	a := testApp(t)
	router := a.Router()
	for _, kind := range []string{"csrf", "host", "origin"} {
		req := httptest.NewRequest("POST", "http://127.0.0.1:8080/api/v1/rewrites", strings.NewReader(`{"name":"x"}`))
		req.Header.Set("Content-Type", "application/json")
		if kind != "csrf" {
			req.Header.Set("X-CSRF-Token", a.CSRF)
		}
		if kind == "host" {
			req.Host = "evil.example"
		}
		if kind == "origin" {
			req.Header.Set("Origin", "https://evil.example")
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatalf("%s allowed", kind)
		}
	}
	asset := sampleImage(t, a)
	req := httptest.NewRequest("GET", "http://127.0.0.1:8080/api/v1/assets/"+asset.ID+"/file", nil)
	req.Header.Set("Range", "bytes=0-9")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 206 || w.Body.Len() != 10 {
		t.Fatal("Range not supported")
	}
	outside := filepath.Join(a.Config.DataDir, "private.txt")
	os.WriteFile(outside, []byte("private"), 0600)
	if _, e := a.mediaPath("../private.txt"); e == nil {
		t.Fatal("directory escape allowed")
	}
	badAsset := domain.Asset{ID: ID()}
	if e := a.ingest(strings.NewReader("<html>not media</html>"), &badAsset); e == nil {
		t.Fatal("non-media accepted")
	}
}
func TestCollectorContractDedupeAndSourceHistory(t *testing.T) {
	a := testApp(t)
	revision := 1
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["download"] != false || body["check_record"] != false || r.Header.Get("X-Collector-Token") != a.CollectorToken {
			t.Error("collector contract mismatch")
		}
		title := "第一次"
		if revision == 2 {
			title = "重新采集"
		}
		json.NewEncoder(w).Encode(map[string]any{"params": map[string]string{"cookie": "DO-NOT-STORE-ME"}, "data": map[string]any{"作品ID": "abc123", "作品类型": "图文", "作品标题": title, "作品描述": "原文", "作品标签": "生活 分享", "作者昵称": "作者", "点赞数量": "1.2万", "收藏数量": "0", "下载地址": []string{"https://sns-webpic-qc.xhscdn.com/test.jpg"}}})
	}))
	defer mock.Close()
	a.Config.CollectorURL = mock.URL
	j := newJob("collect", "https://www.xiaohongshu.com/explore/abc123", map[string]any{"url": "https://www.xiaohongshu.com/explore/abc123"})
	id, e := a.runCollect(j)
	if e != nil {
		t.Fatal(e)
	}
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": id}, 201))
	if !strings.Contains(p.Sources[0].Text, "第一次") {
		t.Fatal("missing source snapshot")
	}
	same, e := a.runCollect(j)
	if e != nil || same != id {
		t.Fatal("dedupe failed")
	}
	revs, _ := store.List[domain.Revision](a.Store.DB, "revisions")
	if len(revs) != 1 {
		t.Fatal("duplicate revision on repeated submission")
	}
	revision = 2
	j.Payload["recollect"] = true
	if _, e = a.runCollect(j); e != nil {
		t.Fatal(e)
	}
	revs, _ = store.List[domain.Revision](a.Store.DB, "revisions")
	if len(revs) != 2 {
		t.Fatal("history not preserved")
	}
	p2, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	if !strings.Contains(p2.Sources[0].Text, "第一次") {
		t.Fatal("source snapshot overwritten")
	}
	for _, table := range []string{"notes", "revisions", "assets", "jobs", "projects"} {
		rows, _ := a.Store.DB.Query("SELECT data FROM " + table)
		for rows.Next() {
			var s string
			rows.Scan(&s)
			if strings.Contains(s, "DO-NOT-STORE-ME") || strings.Contains(s, `"params"`) {
				t.Fatal("secret retained in " + table)
			}
		}
		rows.Close()
	}
}
func TestUnconfiguredAndRestartRecovery(t *testing.T) {
	a := testApp(t)
	if _, e := a.runRewrite(newJob("rewrite", "x", map[string]any{})); e != errConfig {
		t.Fatalf("expected configuration block, got %v", e)
	}
	paid := newJob("rewrite", "x", nil)
	paid.State = "running"
	collect := newJob("collect", "x", nil)
	collect.State = "running"
	store.Put(a.Store.DB, "jobs", paid.ID, paid)
	store.Put(a.Store.DB, "jobs", collect.ID, collect)
	a.StartWorkers()
	got, _ := store.Get[domain.Job](a.Store.DB, "jobs", paid.ID)
	if got.State != "needs_review" {
		t.Fatal("paid request auto-retried")
	}
	got, _ = store.Get[domain.Job](a.Store.DB, "jobs", collect.ID)
	if got.State != "queued" {
		t.Fatal("safe task not recovered")
	}
}
func TestSettingsSecretRoundTrip(t *testing.T) {
	a := testApp(t)
	sealed, e := adapter.Seal("test-key-no-real-value")
	if e != nil {
		t.Skip(e)
	}
	s := a.settings()
	s.Text.Secret = sealed
	store.Put(a.Store.DB, "settings", "services", s)
	body := request(t, a, "GET", "/settings", nil, 200)
	if bytes.Contains(body, []byte("test-key-no-real-value")) || bytes.Contains(body, []byte(sealed)) {
		t.Fatal("settings leaked credential")
	}
	plain, e := adapter.Unseal(sealed)
	if e != nil || plain != "test-key-no-real-value" {
		t.Fatal("DPAPI failed")
	}
}
func TestLinkRecognition(t *testing.T) {
	text := "分享 https://www.xiaohongshu.com/explore/abc?xsec_token=x，短链 https://xhslink.com/a/test。坏 https://www.xiaohongshu.com.evil.test/explore/abc 重复 https://xhslink.com/a/test"
	links := parseLinks(text)
	if len(links) != 2 {
		t.Fatalf("got %v", links)
	}
}

func TestCollectionFailureCategoriesDoNotLeakUpstreamData(t *testing.T) {
	a := testApp(t)
	code := "network_unreachable"
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		json.NewDecoder(r.Body).Decode(&request)
		if request["cookie"] != "" {
			t.Error("default public collection must not require cookie")
		}
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}, "error_code": code, "params": map[string]string{"cookie": "SECRET"}, "error": "untrusted SECRET"})
	}))
	defer mock.Close()
	a.Config.CollectorURL = mock.URL
	job := newJob("collect", "link", map[string]any{"url": "https://www.xiaohongshu.com/explore/abc123?xsec_token=test"})
	for _, item := range []struct{ code, want string }{{"network_unreachable", "网络连接失败"}, {"login_required", "登录限制"}, {"missing_share_token", "分享校验参数"}, {"SECRET", "未知错误"}} {
		code = item.code
		_, err := a.runCollect(job)
		if err == nil || !strings.Contains(err.Error(), item.want) || strings.Contains(err.Error(), "SECRET") {
			t.Fatalf("bad error mapping: %v", err)
		}
	}
}
