package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type dyTestTransport func(*http.Request) (*http.Response, error)

func (f dyTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDouyinHandoffDevelopmentLifecycle(t *testing.T) {
	a := testApp(t)
	a.Config.MobilePublishConfigDir = t.TempDir()
	write := func(name string, v any) {
		t.Helper()
		b, _ := json.Marshal(v)
		if e := os.WriteFile(filepath.Join(a.mobileRoot(), name), b, 0600); e != nil {
			t.Fatal(e)
		}
	}
	key := strings.Repeat("k", 40)
	for _, name := range []string{"control.key", "app.key"} {
		if e := os.WriteFile(filepath.Join(a.mobileRoot(), name), []byte(key), 0600); e != nil {
			t.Fatal(e)
		}
	}
	write("config.douyin.local.json", douyinMobileConfig{ServerURL: "https://cloud.example.test", ControlKeyFile: "control.key", AppSecretFile: "app.key", AppID: "ttdfd3a96e41ad16a601", StorageHost: "fixture.volces.com", LaunchEnvironment: "development"})
	media := []byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isomfixture")
	asset := domain.Asset{ID: ID(), Kind: "video", Status: "ready", Path: "fixture.mp4"}
	if e := os.WriteFile(filepath.Join(a.Config.DataDir, "media", asset.Path), media, 0600); e != nil {
		t.Fatal(e)
	}
	v := domain.Version{ID: ID(), ProjectID: ID(), Status: "confirmed", Content: domain.Content{Title: "视频测试", Body: "正文内容", Topics: []string{"测试"}}, Media: &domain.VersionMedia{Kind: "video", AssetIDs: []string{asset.ID}}}
	p := domain.Publication{ID: ID(), ProjectID: v.ProjectID, VersionID: v.ID, TargetPlatform: "douyin", Kind: "video", Ready: true, AssetIDs: v.Media.AssetIDs, Content: v.Content}
	for _, item := range []struct {
		table, id string
		value     any
	}{{"assets", asset.ID, asset}, {"versions", v.ID, v}, {"publications", p.ID, p}} {
		if e := store.Put(a.Store.DB, item.table, item.id, item.value); e != nil {
			t.Fatal(e)
		}
	}
	creates, puts, commits, cancels := 0, 0, 0, 0
	state := "ready"
	expiry := time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339)
	session := func(s string) map[string]any {
		return map[string]any{"id": "fixture-session", "state": s, "expiresAt": expiry}
	}
	prior := http.DefaultTransport
	http.DefaultTransport = dyTestTransport(func(r *http.Request) (*http.Response, error) {
		var data any
		if r.URL.Host == "fixture.volces.com" {
			puts++
			b, _ := io.ReadAll(r.Body)
			if r.Method != "PUT" || r.ContentLength != int64(len(media)) || !bytes.Equal(b, media) || r.Header.Get("Content-Type") != "video/mp4" || r.Header.Get("Authorization") != "" {
				t.Error("incorrect or credential-leaking storage upload")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
		}
		if r.URL.Host != "cloud.example.test" {
			t.Fatalf("development mode contacted official QR endpoint")
		}
		if r.Header.Get("Authorization") != "Bearer "+key {
			t.Error("missing control authentication")
		}
		switch r.URL.Path {
		case "/v1/douyin/control/create":
			creates++
			var snap map[string]any
			json.NewDecoder(r.Body).Decode(&snap)
			if snap["title"] != p.Title || snap["body"] != p.Body {
				t.Error("incorrect publication snapshot")
			}
			data = map[string]any{"session": session("uploading"), "ticket": strings.Repeat("a", 43), "uploads": []any{map[string]any{"assetId": asset.ID, "url": "https://fixture.volces.com/object?signature=private", "expiresAt": expiry}}}
		case "/v1/douyin/control/commit":
			commits++
			data = map[string]any{"session": session("ready")}
		case "/v1/douyin/control/status":
			data = map[string]any{"session": session(state), "clientResult": map[string]any{"event": "client_publish_success"}}
		case "/v1/douyin/control/cancel":
			cancels++
			data = map[string]bool{"cancelled": true}
		default:
			t.Fatalf("unexpected control action")
		}
		b, _ := json.Marshal(map[string]any{"code": 0, "data": data})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(b)), Header: make(http.Header)}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = prior })
	path := "/publications/" + p.ID + "/douyin-handoff"
	cap := request(t, a, "GET", "/miniapp/douyin/cloud", nil, 200)
	if !bytes.Contains(cap, []byte(`"launch_environment":"development"`)) {
		t.Fatal("development mode not advertised")
	}
	first := request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("b", 32)}, 201)
	if !bytes.Contains(first, []byte(`pages/publish/index?ticket=`)) || bytes.Contains(first, []byte("qr_image")) {
		t.Fatal("wrong development launch response")
	}
	duplicate := request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("c", 32)}, 200)
	if bytes.Contains(duplicate, []byte("ticket=")) {
		t.Fatal("duplicate request restored task credential")
	}
	state = "editor_opened"
	polled := request(t, a, "GET", path, nil, 200)
	if !bytes.Contains(polled, []byte("client_publish_success")) || bytes.Contains(polled, []byte("ticket=")) || bytes.Contains(polled, []byte(key)) {
		t.Fatal("incorrect or leaking status response")
	}
	current, e := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if e != nil || current.PublishedAt != "" || current.RemoteWorkID != "" {
		t.Fatal("client event falsely marked publication published")
	}
	request(t, a, "POST", path+"/cancel", nil, 200)
	if creates != 1 || puts != 1 || commits != 1 || cancels != 1 {
		t.Fatalf("unexpected operation counts %d %d %d %d", creates, puts, commits, cancels)
	}
	// A changed file cannot produce a task for a stale confirmed asset checksum.
	asset.SHA256 = strings.Repeat("0", 64)
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("d", 32)}, 409)
	if creates != 1 {
		t.Fatal("invalid media reached cloud")
	}
	// XHS publications cannot use a Douyin handoff.
	p.TargetPlatform = "xhs"
	store.Put(a.Store.DB, "publications", p.ID, p)
	request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("e", 32)}, 409)
}

func TestDouyinUploadRejectsUntrustedHost(t *testing.T) {
	d := &douyinMobileClient{config: douyinMobileConfig{StorageHost: "fixture.volces.com"}}
	for _, host := range []string{"https://evil.test/x", "https://fixture.volces.com.evil.test/x", "http://fixture.volces.com/x", "https://fixture.volces.com:443/x"} {
		err := d.upload(t.Context(), douyinMobileUpload{URL: host, ExpiresAt: time.Now().Add(time.Minute).Format(time.RFC3339)}, "missing", 10)
		if err == nil || err.Error() != "抖音上传地址无效" {
			t.Error("untrusted upload URL accepted")
		}
	}
}
