package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/handoffcloud"
	"xhs-workbench/internal/store"
)

func mobileFixture(t *testing.T) (*App, domain.Publication, *atomic.Int32, *httptest.Server) {
	t.Helper()
	a := testApp(t)
	a.Config.MobilePublishConfigDir = t.TempDir()
	key := strings.Repeat("fixture-private-key-", 3)
	relay, err := handoffcloud.New(handoffcloud.Config{DataDir: t.TempDir(), PublicURL: "https://phone.example.test", ControlKey: key})
	if err != nil {
		t.Fatal(err)
	}
	uploads := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/control/sessions" && r.Method == "POST" {
			uploads.Add(1)
		}
		relay.Handler().ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	keyPath := filepath.Join(a.mobileRoot(), "control.key")
	os.WriteFile(keyPath, []byte(key), 0600)
	write := func(name string, value any) {
		b, _ := json.Marshal(value)
		if err := os.WriteFile(filepath.Join(a.mobileRoot(), name), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("config.cloud.local.json", miniappCloudConfig{ServerURL: server.URL, PublicURL: "https://phone.example.test", ControlKeyFile: keyPath})
	write("config.miniapp.local.json", miniappLocalConfig{ProjectPath: a.mobileRoot(), LaunchEnvironment: "trial"})
	write("project.config.json", map[string]string{"appid": "123456789012345678901234"})
	first, cover := sampleImage(t, a), sampleImage(t, a)
	v := domain.Version{ID: ID(), ProjectID: ID(), Status: "confirmed", Content: domain.Content{Title: "手机发布回归", Body: "完整正文内容", Topics: []string{"旅行", "生活"}}, Media: &domain.VersionMedia{Kind: "image", AssetIDs: []string{first.ID, cover.ID}, CoverID: cover.ID}}
	p := domain.Publication{ID: ID(), ProjectID: v.ProjectID, VersionID: v.ID, TargetPlatform: "xhs", Content: v.Content, Kind: "image", AssetIDs: append([]string{}, v.Media.AssetIDs...), CoverID: cover.ID, Ready: true}
	if err := store.Put(a.Store.DB, "versions", v.ID, v); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(a.Store.DB, "publications", p.ID, p); err != nil {
		t.Fatal(err)
	}
	return a, p, uploads, server
}

func TestMobileHandoffFullProtocolAndNoFalsePublish(t *testing.T) {
	a, p, uploads, server := mobileFixture(t)
	path := "/publications/" + p.ID + "/mobile-handoff"
	created := decode[struct {
		miniappCloudSession
		Scheme string `json:"miniapp_scheme_url"`
	}](t, request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("a", 32)}, 201))
	if len(created.Ticket) != 32 || !strings.Contains(created.Scheme, "_trial") || !strings.HasPrefix(created.Scheme, "https://www.xiaohongshu.com/miniapp/status?") {
		t.Fatal("missing valid trial QR")
	}
	// Snapshot is copied into the real relay, with cover first and no local paths.
	openedBody, _ := json.Marshal(map[string]string{"ticket": created.Ticket})
	r, err := http.Post(server.URL+"/v1/development/open", "application/json", bytes.NewReader(openedBody))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatalf("phone open: %d %s", r.StatusCode, b)
	}
	var opened handoffcloud.ReceiverResponse
	if json.Unmarshal(b, &opened) != nil {
		t.Fatal("bad phone response")
	}
	if opened.Envelope.Snapshot.Title != p.Title || opened.Envelope.Snapshot.Body != p.Body || opened.Envelope.Snapshot.Media[0].AssetID != p.CoverID || len(opened.Envelope.Snapshot.Topics) != 2 || bytes.Contains(b, []byte(a.Config.DataDir)) {
		t.Fatal("wrong frozen snapshot")
	}
	for _, endpoint := range []string{"claim", "editor"} {
		req, _ := http.NewRequest("POST", server.URL+"/v1/development/"+endpoint, nil)
		req.Header.Set("Authorization", "Bearer "+opened.ReceiverToken)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("%s %d %s", endpoint, res.StatusCode, payload)
		}
	}
	status := request(t, a, "GET", path, nil, 200)
	if bytes.Contains(status, []byte(created.Ticket)) || bytes.Contains(status, []byte("miniapp_scheme_url")) || bytes.Contains(status, []byte("receiver_token")) {
		t.Fatal("status leaked credential")
	}
	if !bytes.Contains(status, []byte("editor_opened")) {
		t.Fatal(string(status))
	}
	request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("a", 32)}, 200)
	request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("b", 32)}, 200)
	if uploads.Load() != 1 {
		t.Fatal("duplicate upload")
	}
	stored, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if stored.PublishedAt != "" || stored.OnlineState != "" || stored.Title != p.Title {
		t.Fatal("handoff mutated publication")
	}
	request(t, a, "POST", path+"/cancel", nil, 200)
	request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("c", 32)}, 201)
	if uploads.Load() != 2 {
		t.Fatal("new upload after revoke missing")
	}
}

func TestMobileHandoffRejectsWrongPlatformStaleVersionAndMedia(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*App, *domain.Publication)
	}{
		{"douyin", func(a *App, p *domain.Publication) { p.TargetPlatform = "douyin" }},
		{"video", func(a *App, p *domain.Publication) { p.Kind = "video" }},
		{"published", func(a *App, p *domain.Publication) { p.PublishedAt = Now() }},
		{"busy", func(a *App, p *domain.Publication) { p.OnlineState = "preparing" }},
		{"blank", func(a *App, p *domain.Publication) { p.Body = " " }},
		{"changed copy", func(a *App, p *domain.Publication) { p.Title = "changed" }},
		{"changed media", func(a *App, p *domain.Publication) {
			v, _ := store.Get[domain.Asset](a.Store.DB, "assets", p.AssetIDs[0])
			os.WriteFile(filepath.Join(a.Config.DataDir, "media", v.Path), []byte("changed"), 0600)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, p, n, _ := mobileFixture(t)
			test.change(a, &p)
			store.Put(a.Store.DB, "publications", p.ID, p)
			request(t, a, "POST", "/publications/"+p.ID+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("a", 32)}, 409)
			if n.Load() != 0 {
				t.Fatal("rejected input uploaded")
			}
		})
	}
}

func TestMobileHandoffUserIsolationAndCSRF(t *testing.T) {
	a, p, n, _ := mobileFixture(t)
	path := "/publications/" + p.ID + "/mobile-handoff"
	other := testApp(t)
	other.Config.MobilePublishConfigDir = a.mobileRoot()
	request(t, other, "GET", path, nil, 404)
	request(t, other, "POST", path+"/cancel", nil, 404)
	req := httptest.NewRequest("POST", "http://127.0.0.1:8080/api/v1"+path, strings.NewReader(`{"request_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
	w := httptest.NewRecorder()
	a.Router().ServeHTTP(w, req)
	if w.Code != 403 || n.Load() != 0 {
		t.Fatal("CSRF bypass")
	}
}

func TestMobileHandoffLostUploadAndExpiryDoNotDuplicate(t *testing.T) {
	a, p, n, server := mobileFixture(t)
	server.Close()
	path := "/publications/" + p.ID + "/mobile-handoff"
	request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("a", 32)}, 502)
	unknown := decode[miniappCloudSession](t, request(t, a, "GET", path, nil, 200))
	if unknown.State != "unknown" {
		t.Fatal(unknown.State)
	}
	request(t, a, "POST", path, map[string]string{"request_id": strings.Repeat("b", 32)}, 200)
	request(t, a, "POST", path+"/cancel", nil, 409)
	if n.Load() != 0 {
		t.Fatal("lost response repeated upload")
	}
	record, _ := store.Get[mobileHandoffRecord](a.Store.DB, "mobile_handoffs", p.ID)
	record.Session.ExpiresAt = time.Now().Add(-time.Second).Format(time.RFC3339)
	store.Put(a.Store.DB, "mobile_handoffs", p.ID, record)
	expired := decode[miniappCloudSession](t, request(t, a, "GET", path, nil, 200))
	if expired.State != "expired" {
		t.Fatal(expired.State)
	}
}
