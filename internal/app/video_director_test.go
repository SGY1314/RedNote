package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func directorFixture(t *testing.T, a *App) (domain.Project, videoScript, rewriteModel) {
	t.Helper()
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "视频导演", "kind": "video"}, 201))
	script := videoScript{Title: "咖啡日常", Concept: "磨豆、注水、享用", Style: "自然光，同一只白杯", Brief: videoBrief{CopyText: "慢下来喝杯咖啡", Duration: 15, ReferenceIDs: []string{}}, Shots: []directorShot{{5, "磨豆", "特写", "磨豆"}, {5, "注水", "推近", "注水"}, {5, "品尝", "拉远", "享用"}}}
	script = decode[videoScript](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/scripts", script, 201))
	m := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]string{"name": "测试 Seedance", "base_url": "https://example.com/api/v3", "model": "doubao-seedance-2-5-260628", "secret": "video-fixture-secret"}, 200))
	return p, script, m
}
func startDirectorVideo(t *testing.T, a *App, p domain.Project, s videoScript, m rewriteModel) domain.Job {
	t.Helper()
	request(t, a, "POST", "/rewrites/"+p.ID+"/video/scripts/"+s.ID+"/confirm", nil, 200)
	result := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/generate", map[string]any{"script_id": s.ID, "model_id": m.ID, "audio": true}, 202))
	j, e := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	if e != nil {
		t.Fatal(e)
	}
	return j
}
func TestVideoDirectorConfirmationVersionsAndDeletion(t *testing.T) {
	a := testApp(t)
	p, s, m := directorFixture(t, a)
	endpoint := "/rewrites/" + p.ID + "/video/generate"
	request(t, a, "POST", endpoint, map[string]any{"script_id": s.ID, "model_id": m.ID}, 409)
	invalid := s
	invalid.Shots = invalid.Shots[:2]
	request(t, a, "POST", "/rewrites/"+p.ID+"/video/scripts", invalid, 400)
	j := startDirectorVideo(t, a, p, s, m)
	duplicate := decode[map[string]string](t, request(t, a, "POST", endpoint, map[string]any{"script_id": s.ID, "model_id": m.ID}, 202))
	if duplicate["job_id"] != j.ID {
		t.Fatal("duplicate paid job")
	}
	s.ParentID = s.ID
	s.Title = "修改后"
	edited := decode[videoScript](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/scripts", s, 201))
	if edited.ID == s.ID || edited.ConfirmedAt != "" {
		t.Fatal("editing must create unconfirmed version")
	}
	old, _ := store.Get[videoScript](a.Store.DB, "video_scripts", s.ID)
	if old.Title == edited.Title || old.ConfirmedAt == "" {
		t.Fatal("old confirmed script mutated")
	}
	request(t, a, "POST", endpoint, map[string]any{"script_id": edited.ID, "model_id": m.ID}, 409)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 409)
	public := string(request(t, a, "GET", "/video-models", nil, 200)) + string(request(t, a, "GET", "/jobs", nil, 200))
	if strings.Contains(public, "video-fixture-secret") {
		t.Fatal("secret leaked")
	}
	j.State = "failed"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 200)
	scripts, _ := store.List[videoScript](a.Store.DB, "video_scripts")
	if len(scripts) != 0 {
		t.Fatal("orphan scripts")
	}
	if _, e := store.Get[domain.Service](a.Store.DB, "settings", "video-job-"+j.ID); e == nil {
		t.Fatal("orphan encrypted service")
	}
}
func TestVideoDirectorPlanUsesActualReferencesNoVideoSubmission(t *testing.T) {
	a := testApp(t)
	p, m := planFixture(t, a, true)
	img := sampleImage(t, a)
	input := videoBrief{ModelID: m.ID, Duration: 15, CopyText: "测试文案", ReferenceIDs: []string{img.ID}}
	result := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/plan", input, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	request(t, a, "POST", "/rewrites/"+p.ID+"/video/plan", input, 409)
	request(t, a, "PUT", "/rewrite-models/"+m.ID, map[string]any{"name": "修改配置", "base_url": "https://changed.example/v1", "model": "changed", "secret": "changed"}, 200)
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "example.com" || r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected endpoint %s", r.URL.Path)
		}
		b, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(b), "data:image/") || !strings.Contains(string(b), "测试文案") {
			t.Fatal("missing actual reference or copy")
		}
		return planReply(`{"title":"标题","concept":"完整故事","style":"统一主体","shots":[{"duration":5,"visual":"打开书","camera":"近景","narration":"打开书"},{"duration":5,"visual":"阅读","camera":"侧面","narration":"阅读"},{"duration":5,"visual":"合上书","camera":"拉远","narration":"合上书"}]}`), nil
	})
	id, e := a.runVideoPlan(j)
	if e != nil {
		t.Fatal(e)
	}
	s, _ := store.Get[videoScript](a.Store.DB, "video_scripts", id)
	if s.ConfirmedAt != "" || s.Model != m.Model || len(s.References) != 1 {
		t.Fatal("invalid planning snapshot")
	}
	if _, e = a.runVideoPlan(j); e != nil || calls != 1 {
		t.Fatal("planning repeats completed request")
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, v := range jobs {
		if v.Kind == "video_generate" {
			t.Fatal("planning auto submitted paid video")
		}
	}
}
func TestVideoDirectorUnknownSubmissionAndResumeQueryOnly(t *testing.T) {
	a := testApp(t)
	p, s, m := directorFixture(t, a)
	j := startDirectorVideo(t, a, p, s, m)
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	posts, gets := 0, 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method == "POST" {
			posts++
			current, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
			var prod videoProduction
			decodeVideoPayload(current, "production", &prod)
			if prod.Shots[0].State != "submitting" {
				t.Fatal("submission marker not persisted before network")
			}
			return nil, errors.New("broken connection")
		}
		gets++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"cgt-known","status":"failed","model":"doubao-seedance-2-5-260628"}`))}, nil
	})
	if _, e := a.runVideoGenerate(j); !errors.Is(e, errVideoUnknown) {
		t.Fatalf("missing unknown-submission guard: %v", e)
	}
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	j.State = "needs_review"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	if videoCanResume(j) {
		t.Fatal("ambiguous submission resumable")
	}
	request(t, a, "POST", "/jobs/"+j.ID+"/retry", nil, 409)
	if _, e := a.runVideoGenerate(j); !errors.Is(e, errVideoUnknown) || posts != 1 {
		t.Fatal("ambiguous request repeated")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/video/productions/"+j.ID+"/link", map[string]any{"shot": 0, "remote_id": "cgt-known"}, 202)
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if !videoCanResume(j) {
		t.Fatal("known remote id cannot resume")
	}
	if _, e := a.runVideoGenerate(j); e == nil {
		t.Fatal("remote failure accepted")
	}
	if posts != 1 || gets != 1 {
		t.Fatal("resume should only query known task")
	}
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	var prod videoProduction
	decodeVideoPayload(j, "production", &prod)
	if prod.Shots[0].RemoteID != "cgt-known" || prod.Shots[0].State != "failed" {
		t.Fatal("remote id or terminal status lost")
	}
}
func TestVideoDirectorPersistsRemoteIDBeforePolling(t *testing.T) {
	a := testApp(t)
	p, s, m := directorFixture(t, a)
	j := startDirectorVideo(t, a, p, s, m)
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	posts := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method == "POST" {
			posts++
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if body["duration"] != float64(5) || body["ratio"] != "9:16" || body["generate_audio"] != true {
				t.Fatal("wrong task parameters")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"cgt-persisted"}`))}, nil
		}
		current, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
		var prod videoProduction
		decodeVideoPayload(current, "production", &prod)
		if prod.Shots[0].RemoteID != "cgt-persisted" {
			t.Fatal("remote id not persisted")
		}
		return nil, errors.New("polling disconnected")
	})
	a.runVideoGenerate(j)
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	a.runVideoGenerate(j)
	if posts != 1 {
		t.Fatal("known task submitted again")
	}
}
func TestVideoDirectorSafeDownloadURLs(t *testing.T) {
	for _, raw := range []string{"http://ark.tos-cn-beijing.volces.com/a", "https://127.0.0.1/a", "https://evilvolces.com/a", "https://x.volces.com.evil.com/a", "https://user:pw@x.volces.com/a", "https://x.volces.com:8080/a"} {
		if generatedVideoURL(raw) == nil {
			t.Fatalf("unsafe download allowed: %s", raw)
		}
	}
	if generatedVideoURL("https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/a.mp4?token=test") != nil {
		t.Fatal("valid CDN rejected")
	}
}
func TestVideoDirectorFramesAndComposition(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("FFmpeg not available")
	}
	a := testApp(t)
	p, s, m := directorFixture(t, a)
	temp := filepath.Join(t.TempDir(), "clip.mp4")
	if e := a.ffmpegVideo("-f", "lavfi", "-i", "color=c=blue:s=180x320:r=30:d=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", temp); e != nil {
		t.Fatal(e)
	}
	f, _ := os.Open(temp)
	asset := domain.Asset{ID: ID(), Name: "视频参考", Kind: "video", CreatedAt: Now()}
	e := a.ingest(f, &asset)
	f.Close()
	if e != nil {
		t.Fatal(e)
	}
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	store.Put(a.Store.DB, "extractions", "asr-fixture", domain.Extraction{ID: "asr-fixture", AssetID: asset.ID, Kind: "asr", Text: "人工修正的口播"})
	refs, e := a.snapshotVideoRefs([]string{asset.ID})
	if e != nil {
		t.Fatal(e)
	}
	content, e := a.videoReferenceContent(refs)
	if e != nil {
		t.Fatal(e)
	}
	encoded, _ := json.Marshal(content)
	if strings.Count(string(encoded), "data:image/jpeg;base64,") != 4 || !strings.Contains(string(encoded), "人工修正的口播") {
		t.Fatal("missing sampled frames / transcript")
	}
	j := startDirectorVideo(t, a, p, s, m)
	var prod videoProduction
	decodeVideoPayload(j, "production", &prod)
	for i := range prod.Shots {
		prod.Shots[i] = videoClip{State: "succeeded", RemoteID: fmtShotID(i), AssetID: asset.ID}
	}
	j.Payload["production"] = prod
	j.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/productions/"+j.ID+"/compose", nil, 202))
	render, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	id, e := a.runVideoCompose(render)
	if e != nil {
		t.Fatal(e)
	}
	v, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
	if e != nil {
		t.Fatal(e)
	}
	if v.LibraryState != "result" || v.Width != 720 || v.Height != 1280 || v.Duration < 14.8 || v.Duration > 15.3 {
		t.Fatalf("invalid output geometry/duration: %+v", v)
	}
	cover, e := store.Get[domain.Asset](a.Store.DB, "assets", id+"-cover")
	if e != nil || cover.Kind != "image" || cover.LibraryState != "result" {
		t.Fatal("missing cover")
	}
	path, _ := a.mediaPath(v.Path)
	probe, e := exec.Command("ffprobe", "-v", "error", "-show_entries", "stream=codec_name,r_frame_rate", "-of", "json", path).Output()
	if e != nil || !strings.Contains(string(probe), "h264") || !strings.Contains(string(probe), "aac") || !strings.Contains(string(probe), "30/1") {
		t.Fatalf("wrong codecs: %s", probe)
	}
	if again, e := a.runVideoCompose(render); e != nil || again != id {
		t.Fatal("completed composition not reused")
	}
}
func fmtShotID(i int) string { return "cgt-fixture-" + string(rune('a'+i)) }
