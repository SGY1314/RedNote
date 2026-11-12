package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

const wanTestHost = "https://ws-fixture.cn-beijing.maas.aliyuncs.com"

func TestWanConfigurationNormalizationAndReadOnlyCheck(t *testing.T) {
	for _, suffix := range []string{"", "/compatible-mode/v1", "/api/v1", "/api/v1/services/aigc/video-generation/video-synthesis"} {
		svc, e := normalizeVideoService(domain.Service{BaseURL: wanTestHost + suffix, Model: "Wan3.0-Video-Prime"})
		if e != nil || svc.BaseURL != wanTestHost+"/api/v1" || svc.Model != "wan3.0-video-prime" {
			t.Fatalf("invalid normalization %+v %v", svc, e)
		}
	}
	for _, svc := range []domain.Service{
		{BaseURL: wanTestHost + "/chat/completions", Model: "wan3.0-video-prime"},
		{BaseURL: wanTestHost + "/api/v1", Model: "qwen-plus"},
		{BaseURL: "https://api.example.com/api/v3", Model: "Wan3.0-Video-Prime"},
		{BaseURL: "https://ws-fixture.cn-beijing.maas.aliyuncs.com.evil.test/api/v1", Model: "wan3.0-video-prime"},
	} {
		if _, e := normalizeVideoService(svc); e == nil {
			t.Fatal("invalid provider/model accepted")
		}
	}
	regional, e := normalizeVideoService(domain.Service{BaseURL: "https://ws-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", Model: "WAN3.0-VIDEO"})
	if e != nil || regional.BaseURL != "https://ws-fixture.ap-southeast-1.maas.aliyuncs.com/api/v1" {
		t.Fatal("region changed")
	}
	a := testApp(t)
	m := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]string{"name": "万相", "base_url": wanTestHost + "/compatible-mode/v1", "model": "Wan3.0-Video-Prime", "secret": "fixture-key"}, 200))
	if m.Model != "wan3.0-video-prime" || m.BaseURL != wanTestHost+"/api/v1" || m.Secret != "" {
		t.Fatal("public configuration incorrect")
	}
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "GET" || r.URL.String() != wanTestHost+"/compatible-mode/v1/models" || r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Fatal("connection check tried wrong/paid endpoint")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[{"id":"wan3.0-video-prime"}]}`))}, nil
	})
	request(t, a, "POST", "/video-models/"+m.ID+"/test", nil, 200)
	if calls != 1 {
		t.Fatal("extra connection check requests")
	}
}

func wanJobFixture(t *testing.T, a *App) domain.Job {
	p, s, m := directorFixture(t, a)
	j := startDirectorVideo(t, a, p, s, m)
	secret, e := adapter.Seal("fixture-wan-key")
	if e != nil {
		t.Fatal(e)
	}
	// Reproduce a pre-fix snapshot using the chat-compatible URL and display name.
	svc := domain.Service{BaseURL: wanTestHost + "/compatible-mode/v1", Model: "Wan3.0-Video-Prime", Secret: secret}
	if e := store.Put(a.Store.DB, "settings", "video-job-"+j.ID, svc); e != nil {
		t.Fatal(e)
	}
	return j
}

func TestWanGenerationContractAndResumeNeverReposts(t *testing.T) {
	a := testApp(t)
	j := wanJobFixture(t, a)
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	posts, gets := 0, 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer fixture-wan-key" {
			t.Fatal("credential changed")
		}
		if r.Method == "POST" {
			posts++
			if r.URL.String() != wanTestHost+"/api/v1/services/aigc/video-generation/video-synthesis" || r.Header.Get("X-DashScope-Async") != "enable" {
				t.Fatal("wrong Wan task endpoint/header")
			}
			var body struct {
				Model      string         `json:"model"`
				Input      map[string]any `json:"input"`
				Parameters map[string]any `json:"parameters"`
				Content    any            `json:"content"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if body.Model != "wan3.0-video-prime" || body.Input["prompt"] == nil || body.Content != nil || body.Parameters["duration"] != float64(5) || body.Parameters["audio"] != true || body.Parameters["resolution"] != "720P" || body.Parameters["ratio"] != "9:16" || body.Parameters["prompt_extend"] != false {
				t.Fatal("wrong Wan task payload")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"output":{"task_id":"wan-fixture-task","task_status":"PENDING"}}`))}, nil
		}
		gets++
		if r.URL.String() != wanTestHost+"/api/v1/tasks/wan-fixture-task" {
			t.Fatal("wrong poll endpoint")
		}
		saved, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
		var p videoProduction
		decodeVideoPayload(saved, "production", &p)
		if p.Shots[0].RemoteID != "wan-fixture-task" {
			t.Fatal("task ID not durable before polling")
		}
		if gets == 1 {
			return nil, errors.New("poll disconnected")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"output":{"task_id":"wan-fixture-task","task_status":"FAILED","code":"InvalidParameter","message":"fixture-wan-key"}}`))}, nil
	})
	if _, e := a.runVideoGenerate(j); e == nil {
		t.Fatal("disconnected poll reported success")
	}
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	_, e := a.runVideoGenerate(j)
	if e == nil || posts != 1 || gets != 2 || strings.Contains(e.Error(), "fixture-wan-key") || !strings.Contains(e.Error(), "InvalidParameter") {
		t.Fatalf("bad retry: posts=%d gets=%d error=%v", posts, gets, e)
	}
	saved, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	var p videoProduction
	decodeVideoPayload(saved, "production", &p)
	if p.Shots[0].State != "failed" || p.Shots[0].RemoteID != "wan-fixture-task" {
		t.Fatal("remote failure lost")
	}
}

func TestWanUnknownSubmissionAndSafeDownloadDomains(t *testing.T) {
	a := testApp(t)
	j := wanJobFixture(t, a)
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("lost submit response") })
	if _, e := a.runVideoGenerate(j); !errors.Is(e, errVideoUnknown) {
		t.Fatal("unknown submission not paused")
	}
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if _, e := a.runVideoGenerate(j); !errors.Is(e, errVideoUnknown) || calls != 1 {
		t.Fatal("uncertain submission charged twice")
	}
	svc := domain.Service{BaseURL: wanTestHost + "/api/v1", Model: "wan3.0-video-prime"}
	for _, raw := range []string{"http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/v.mp4", "https://127.0.0.1/v.mp4", "https://bucket.oss-cn-beijing.aliyuncs.com.evil.test/v.mp4", "https://u:p@bucket.oss-cn-beijing.aliyuncs.com/v.mp4", "https://bucket.oss-cn-beijing.aliyuncs.com:8443/v.mp4", "https://example.com/v.mp4"} {
		if generatedVideoURLForService(raw, svc) == nil {
			t.Fatal("unsafe Wan download accepted")
		}
	}
	if generatedVideoURLForService("https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/v.mp4?signature=fixture", svc) != nil {
		t.Fatal("official result URL rejected")
	}
}

func TestWanSuccessfulResultAndStatusMapping(t *testing.T) {
	a := testApp(t)
	j := wanJobFixture(t, a)
	svc, _ := store.Get[domain.Service](a.Store.DB, "settings", "video-job-"+j.ID)
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	for remote, local := range map[string]string{"PENDING": "queued", "RUNNING": "running", "SUCCEEDED": "succeeded", "FAILED": "failed", "CANCELED": "cancelled", "UNKNOWN": "unknown"} {
		http.DefaultTransport = rewriteTransport(func(*http.Request) (*http.Response, error) {
			raw, _ := json.Marshal(map[string]any{"output": map[string]string{"task_id": "wan-task", "task_status": remote, "code": "fixture-wan-key", "video_url": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/v.mp4"}})
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
		})
		got, _, e := a.queryVideoTask(svc, "wan-task")
		if e != nil || got.ID != "wan-task" || got.Status != local || got.Content.VideoURL == "" || got.FailureCode != "" {
			t.Fatalf("wrong mapping %s: %+v %v", remote, got, e)
		}
	}
}
