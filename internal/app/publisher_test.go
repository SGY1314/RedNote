package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func publishFixture(t *testing.T, a *App) domain.Publication {
	asset := sampleImage(t, a)
	p := domain.Publication{ID: ID(), Kind: "image", Ready: true, AssetIDs: []string{asset.ID}, Content: domain.Content{Title: "发布测试", Body: "快照正文", Topics: []string{"旅行"}}}
	if err := store.Put(a.Store.DB, "publications", p.ID, p); err != nil {
		t.Fatal(err)
	}
	return p
}

func mockPublisher(t *testing.T, a *App, account string, verified bool, posts *atomic.Int32) {
	t.Helper()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/publish" || r.URL.Path == "/api/v1/publish_video" {
			t.Error("automatic submission endpoint called")
			w.WriteHeader(500)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+a.PublisherToken {
			t.Error("missing internal authentication")
			w.WriteHeader(401)
			return
		}
		data := any(map[string]any{"is_logged_in": true, "user_id": account, "username": "测试账号"})
		if r.URL.Path == "/api/v1/prepare" || r.URL.Path == "/api/v1/prepare_video" {
			posts.Add(1)
			var payload struct {
				EditorID string   `json:"editor_id"`
				Title    string   `json:"title"`
				Images   []string `json:"images"`
				Expected string   `json:"expected_user_id"`
			}
			json.NewDecoder(r.Body).Decode(&payload)
			if payload.EditorID == "" || payload.Title != "发布测试" || payload.Expected != account || len(payload.Images) != 1 || !filepath.IsAbs(payload.Images[0]) {
				t.Error("invalid snapshot payload")
			}
			pubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
			if len(pubs) == 0 || pubs[0].OnlineState != "needs_review" {
				t.Error("remote request preceded durable ambiguity marker")
			}
			data = map[string]any{"prepared": verified, "verified": false, "status": "等待手动发布"}
		}
		json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	})
	previous := http.DefaultTransport
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Result(), nil
	})
	t.Cleanup(func() { http.DefaultTransport = previous })
	a.Config.PublisherURL = "http://127.0.0.1:18060"
}

func queuePublish(t *testing.T, a *App, p domain.Publication) domain.Job {
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish", map[string]any{"account_id": "account-one", "confirm": true}, 202))
	j, err := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	if err != nil {
		t.Fatal(err)
	}
	return j
}

func TestPublishPreparationNeverMarksPublishedAndPreventsDuplicate(t *testing.T) {
	a := testApp(t)
	p := publishFixture(t, a)
	var posts atomic.Int32
	mockPublisher(t, a, "account-one", true, &posts)
	request(t, a, "POST", "/publications/"+p.ID+"/publish", map[string]any{"account_id": "account-one"}, 400)
	j := queuePublish(t, a, p)
	request(t, a, "POST", "/publications/"+p.ID+"/publish", map[string]any{"account_id": "account-one", "confirm": true}, 409)
	if _, err := a.runPublish(j); err != nil {
		t.Fatal(err)
	}
	if _, err := a.runPublish(j); !errors.Is(err, errPublishReview) {
		t.Fatal("repeated job not blocked", err)
	}
	got, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if got.PublishedAt != "" || got.SubmittedAt != "" || got.OnlineState != "manual_ready" || got.Body != p.Body || posts.Load() != 1 {
		t.Fatal("bad publish result")
	}
}

func TestPublishUncertainIsNotSuccessOrRetryable(t *testing.T) {
	a := testApp(t)
	p := publishFixture(t, a)
	var posts atomic.Int32
	mockPublisher(t, a, "account-one", false, &posts)
	j := queuePublish(t, a, p)
	if _, err := a.runPublish(j); !errors.Is(err, errPublishReview) {
		t.Fatal(err)
	}
	got, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if got.PublishedAt != "" || got.OnlineState != "needs_review" {
		t.Fatal("unverified response treated as success")
	}
	request(t, a, "POST", "/jobs/"+j.ID+"/retry", nil, 409)
	request(t, a, "POST", "/publications/"+p.ID+"/resolve", map[string]bool{"not_published": true}, 409)
	j.State = "needs_review"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/publications/"+p.ID+"/resolve", map[string]bool{}, 400)
	request(t, a, "POST", "/publications/"+p.ID+"/resolve", map[string]bool{"not_published": true}, 200)
	got, _ = store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if got.OnlineState != "failed" {
		t.Fatal("manual resolution not saved")
	}
}

func TestPublishWrongAccountAndMissingFileNeverSubmit(t *testing.T) {
	for _, mode := range []string{"account", "file"} {
		t.Run(mode, func(t *testing.T) {
			a := testApp(t)
			p := publishFixture(t, a)
			var posts atomic.Int32
			account := "different"
			if mode == "file" {
				account = "account-one"
				asset, _ := store.Get[domain.Asset](a.Store.DB, "assets", p.AssetIDs[0])
				asset.Path = "missing.png"
				store.Put(a.Store.DB, "assets", asset.ID, asset)
			}
			mockPublisher(t, a, account, true, &posts)
			j := queuePublish(t, a, p)
			if _, err := a.runPublish(j); err == nil {
				t.Fatal("preflight incorrectly succeeded")
			}
			got, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
			if got.OnlineState != "failed" || posts.Load() != 0 {
				t.Fatal("preflight sent content")
			}
		})
	}
}

func TestPublishRestartRequiresReview(t *testing.T) {
	a := testApp(t)
	p := publishFixture(t, a)
	j := queuePublish(t, a, p)
	j.State = "running"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	a.StartWorkers()
	got, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if got.State != "needs_review" {
		t.Fatal("restart requeued publish")
	}
	request(t, a, "POST", "/publications/"+p.ID+"/publish", map[string]any{"account_id": "account-one", "confirm": true}, 409)
}

func TestPublisherErrorsDoNotLeakCredentials(t *testing.T) {
	a := testApp(t)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"cookie=SECRET"}`))
	}))
	defer s.Close()
	a.Config.PublisherURL = s.URL
	body := request(t, a, "POST", "/publisher/status", nil, 503)
	if strings.Contains(string(body), "SECRET") {
		t.Fatal("upstream error leaked")
	}
	a.Config.PublisherURL = "https://example.com"
	request(t, a, "POST", "/publisher/status", nil, 503)
}

func TestPublishPrepareRoutePreviewAndReset(t *testing.T) {
	a := testApp(t)
	p := publishFixture(t, a)
	var posts atomic.Int32
	mockPublisher(t, a, "account-one", true, &posts)
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]any{"account_id": "account-one", "confirm": true}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	if _, err := a.runPublish(j); err != nil {
		t.Fatal(err)
	}
	j.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/publications/"+p.ID+"/open-editor", nil, 200)
	request(t, a, "POST", "/publications/"+p.ID+"/resolve", map[string]bool{"not_published": true}, 200)
	p, _ = store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if p.PublishedAt != "" || p.OnlineState != "failed" || posts.Load() != 1 {
		t.Fatal("preview/reset changed publication result or reuploaded")
	}
}

func TestPublishPrepareNeverFallsBackToAutomaticEndpoint(t *testing.T) {
	a := testApp(t)
	p := publishFixture(t, a)
	var posts atomic.Int32
	mockPublisher(t, a, "account-one", true, &posts)
	transport := http.DefaultTransport
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/prepare") {
			return &http.Response{StatusCode: 404, Body: io.NopCloser(bytes.NewBufferString(`{"success":false}`)), Header: make(http.Header)}, nil
		}
		return transport.RoundTrip(r)
	})
	j := queuePublish(t, a, p)
	if _, err := a.runPublish(j); !errors.Is(err, errPublishReview) {
		t.Fatal(err)
	}
	p, _ = store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if posts.Load() != 0 || p.PublishedAt != "" || p.OnlineState != "needs_review" {
		t.Fatal("old adapter triggered automatic fallback or success")
	}
}

func TestPublishPreparationAcceptsOnlyExplicitManualRecord(t *testing.T) {
	a := testApp(t)
	p := publishFixture(t, a)
	var posts atomic.Int32
	mockPublisher(t, a, "account-one", true, &posts)
	j := queuePublish(t, a, p)
	if _, err := a.runPublish(j); err != nil {
		t.Fatal(err)
	}
	request(t, a, "PATCH", "/publications/"+p.ID, map[string]string{"published_at": Now(), "published_url": "https://www.xiaohongshu.com/explore/0123456789abcdef01234567"}, 200)
	p, _ = store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if p.PublishedAt == "" || p.OnlineState != "published" {
		t.Fatal("manual publication record missing")
	}
	request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]any{"account_id": "account-one", "confirm": true}, 409)
}
