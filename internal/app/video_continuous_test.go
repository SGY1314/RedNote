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

func continuousScript(seconds int) videoScript {
	return videoScript{Title: "咖啡日常", Concept: "从制作到品尝的一次完整过程", Style: "同一人物和白杯，动作连续", Brief: videoBrief{Mode: "continuous", Duration: seconds, CopyText: "慢下来喝杯咖啡"}, Shots: []directorShot{{seconds, "0-6秒磨豆；6-17秒接着注水；17-23秒端起白杯品尝", "跟随手部动作自然拉远", "一杯咖啡，慢慢享用"}}}
}

func TestContinuousVideoValidationAndModelLimits(t *testing.T) {
	s := continuousScript(23)
	wan := domain.Service{BaseURL: wanTestHost + "/api/v1", Model: "wan3.0-video-prime"}
	if e := validateContinuousVideo(s, wan); e != nil {
		t.Fatal(e)
	}
	for _, n := range []int{1, 31, 60} {
		if validateVideoScript(continuousScript(n)) == nil {
			t.Fatalf("accepted duration %d", n)
		}
	}
	bad := s
	bad.Shots = append([]directorShot{}, s.Shots...)
	bad.Shots = append(bad.Shots, s.Shots[0])
	if validateVideoScript(bad) == nil {
		t.Fatal("accepted multiple independent clips")
	}
	bad = continuousScript(23)
	bad.Shots[0].Duration = 10
	if validateVideoScript(bad) == nil {
		t.Fatal("accepted partial duration")
	}
	seed := domain.Service{BaseURL: "https://ark.cn-beijing.volces.com/api/v3", Model: "doubao-seedance-2-0-260128"}
	if validateContinuousVideo(s, seed) == nil {
		t.Fatal("ignored model limit")
	}
	seed.Model = "doubao-seedance-2-5-260628"
	if e := validateContinuousVideo(s, seed); e != nil {
		t.Fatal(e)
	}
	seed.Model = "unknown-custom-model"
	if validateContinuousVideo(s, seed) == nil {
		t.Fatal("guessed unknown model capability")
	}
}

func TestContinuousVideoPlanCustomDurationAndSingleSubmission(t *testing.T) {
	a := testApp(t)
	p, planner := planFixture(t, a, true)
	img := sampleImage(t, a)
	b := continuousScript(23).Brief
	b.ModelID, b.ReferenceIDs = planner.ID, []string{img.ID}
	result := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/plan", b, 202))
	plan, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		for _, want := range []string{"data:image/", "23 秒", "shots 数组必须只有一个元素", "不重复介绍", "最后准确结束在 23 秒"} {
			if !strings.Contains(string(body), want) {
				t.Fatalf("missing planning instruction: %s", want)
			}
		}
		raw, _ := json.Marshal(continuousScript(23))
		return planReply(string(raw)), nil
	})
	id, e := a.runVideoPlan(plan)
	if e != nil {
		t.Fatal(e)
	}
	s, _ := store.Get[videoScript](a.Store.DB, "video_scripts", id)
	if s.Brief.Mode != "continuous" || s.Brief.Duration != 23 || len(s.Shots) != 1 || len(s.References) != 1 {
		t.Fatal("lost continuous script or reference")
	}
	m := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]string{"name": "万相", "base_url": wanTestHost + "/api/v1", "model": "wan3.0-video-prime", "secret": "fixture-key"}, 200))
	public := decode[[]rewriteModel](t, request(t, a, "GET", "/video-models", nil, 200))
	if len(public) != 1 || public[0].ContinuousMin != 2 || public[0].ContinuousMax != 30 {
		t.Fatal("missing public limits")
	}
	j := startDirectorVideo(t, a, p, s, m)
	posts, gets := 0, 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method == "POST" {
			posts++
			var body struct {
				Input      map[string]string `json:"input"`
				Parameters map[string]any    `json:"parameters"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			prompt := body.Input["prompt"]
			if body.Parameters["duration"] != float64(23) || !strings.Contains(prompt, "完整连续的 23 秒") || !strings.Contains(prompt, s.Shots[0].Visual) || strings.Contains(prompt, "只制作本镜") {
				t.Fatal("not a complete single generation request")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"output":{"task_id":"continuous-task","task_status":"PENDING"}}`))}, nil
		}
		gets++
		return nil, errors.New("fixture poll disconnected")
	})
	for i := 0; i < 2; i++ {
		if _, e := a.runVideoGenerate(j); e == nil {
			t.Fatal("reported unverified success")
		}
		j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	}
	var prod videoProduction
	decodeVideoPayload(j, "production", &prod)
	if posts != 1 || gets != 2 || len(prod.Shots) != 1 || prod.Shots[0].RemoteID != "continuous-task" {
		t.Fatal("video split or resubmitted")
	}
}

func TestContinuousVideoRejectsBeforeQueue(t *testing.T) {
	a := testApp(t)
	p, _, _ := directorFixture(t, a)
	s := decode[videoScript](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/scripts", continuousScript(23), 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/video/scripts/"+s.ID+"/confirm", nil, 200)
	m := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]string{"name": "短时长模型", "base_url": "https://ark.cn-beijing.volces.com/api/v3", "model": "doubao-seedance-2-0-260128", "secret": "fixture-key"}, 200))
	request(t, a, "POST", "/rewrites/"+p.ID+"/video/generate", map[string]any{"script_id": s.ID, "model_id": m.ID}, 400)
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, j := range jobs {
		if j.Kind == "video_generate" {
			t.Fatal("queued unsupported paid generation")
		}
	}
}

func TestContinuousVideoSingleClipComposition(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("FFmpeg unavailable")
	}
	a := testApp(t)
	p, _, m := directorFixture(t, a)
	s := continuousScript(7)
	s.Shots[0].Visual = "0-3秒端起白杯；3-7秒连续品尝"
	s = decode[videoScript](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/scripts", s, 201))
	j := startDirectorVideo(t, a, p, s, m)
	temp := filepath.Join(t.TempDir(), "continuous.mp4")
	if e := a.ffmpegVideo("-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=7", "-f", "lavfi", "-i", "sine=frequency=440:duration=7", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", temp); e != nil {
		t.Fatal(e)
	}
	f, e := os.Open(temp)
	if e != nil {
		t.Fatal(e)
	}
	asset := domain.Asset{ID: ID(), Name: "连续视频", Kind: "video", CreatedAt: Now()}
	e = a.ingest(f, &asset)
	f.Close()
	if e != nil {
		t.Fatal(e)
	}
	if e = store.Put(a.Store.DB, "assets", asset.ID, asset); e != nil {
		t.Fatal(e)
	}
	j.Payload["production"] = videoProduction{ScriptID: s.ID, Audio: true, Shots: []videoClip{{RemoteID: "single-task", State: "succeeded", AssetID: asset.ID}}}
	j.State = "succeeded"
	if e = store.Put(a.Store.DB, "jobs", j.ID, j); e != nil {
		t.Fatal(e)
	}
	r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/productions/"+j.ID+"/compose", nil, 202))
	render, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	id, e := a.runVideoCompose(render)
	if e != nil {
		t.Fatal(e)
	}
	v, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
	if e != nil || v.Width != 720 || v.Height != 1280 || v.Duration < 6.8 || v.Duration > 7.3 {
		t.Fatalf("single clip changed length/geometry: %+v %v", v, e)
	}
	if v.ProjectID != p.ID || v.ProjectName != p.Name || v.ScriptID != s.ID || v.ScriptTitle != s.Title {
		t.Fatal("completed video missing library provenance", v)
	}
	if _, e = store.Get[domain.Asset](a.Store.DB, "assets", id+"-cover"); e != nil {
		t.Fatal(e)
	}
}
