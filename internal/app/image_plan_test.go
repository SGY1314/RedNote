package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func planFixture(t *testing.T, a *App, vision bool) (domain.Project, rewriteModel) {
	t.Helper()
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "画面规划"}, 201))
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]any{"name": "画面理解", "model": "vision-fixture", "base_url": "https://example.com/v1", "secret": "plan-key", "vision": vision}, 200))
	return p, m
}

func planReply(content string) *http.Response {
	b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}, "finish_reason": "stop"}}})
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(b))}
}

func TestImagePlanActualReferencesFrozenModelAndEditableGeneration(t *testing.T) {
	a := testApp(t)
	p, m := planFixture(t, a, true)
	if !m.Vision || m.Secret != "" || !m.Configured {
		t.Fatal("vision capability or masking lost")
	}
	ref := sampleImage(t, a)
	refBytes, _ := os.ReadFile(filepath.Join(a.Config.DataDir, "media", ref.Path))
	in := map[string]any{"model_id": m.ID, "count": 2, "copy_text": "未保存文案：先磨豆，再冲咖啡", "prompt": "暖色纪实", "reference_asset_ids": []string{ref.ID}}
	in["creative"] = domain.CreativeSettings{Angle: "咖啡制作细节", ImageHook: "detail"}
	r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/plan-images", in, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	if strings.Contains(jsonString(j), "plan-key") {
		t.Fatal("secret exposed")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/plan-images", in, 409)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 409)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{ref.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{ref.ID}, "confirm": true}, 409)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{ref.ID}, "deleted": false}, 200)
	request(t, a, "PUT", "/rewrite-models/"+m.ID, map[string]any{"name": "新配置", "model": "changed", "base_url": "https://changed.example/v1", "secret": "changed", "vision": false}, 200)
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.String() != "https://example.com/v1/chat/completions" || req.Header.Get("Authorization") != "Bearer plan-key" {
			t.Fatal("unfrozen configuration")
		}
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "vision-fixture" {
			t.Fatal("model snapshot lost")
		}
		var parts []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ImageURL struct {
				URL string `json:"url"`
			} `json:"image_url"`
		}
		if err := json.Unmarshal(body.Messages[1].Content, &parts); err != nil {
			t.Fatal(err)
		}
		if len(parts) != 2 || parts[0].Type != "image_url" {
			t.Fatal("missing actual image")
		}
		img, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(parts[0].ImageURL.URL, "data:image/png;base64,"))
		if err != nil || !bytes.Equal(img, refBytes) {
			t.Fatal("reference bytes changed")
		}
		for _, value := range []string{"未保存文案：先磨豆，再冲咖啡", "暖色纪实", "规划 2 张", "咖啡制作细节", "细节特写", "后续每张推进信息"} {
			if !strings.Contains(parts[1].Text, value) {
				t.Fatal("missing planning input", value)
			}
		}
		return planReply("```json\n{\"scenes\":[\"木桌上红衣人物研磨咖啡豆，暖光近景\",\"同一人物往滤杯缓慢注水，暖光侧面特写\"]}\n```"), nil
	})
	if _, err := a.execute(j); err != nil {
		t.Fatal(err)
	}
	if _, err := a.execute(j); err != nil || calls != 1 {
		t.Fatal("planning charged twice", err, calls)
	}
	done, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	var plan imagePlan
	json.Unmarshal([]byte(jsonString(done.Payload["plan"])), &plan)
	if len(plan.Scenes) != 2 {
		t.Fatal("result not persisted")
	}
	assets, _ := store.List[domain.Asset](a.Store.DB, "assets")
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(assets) != 1 || len(jobs) != 1 {
		t.Fatal("planning generated images without review")
	}
	// User changes the second scene before explicitly requesting image generation.
	plan.Scenes[1] = "用户修改：在窗边端起咖啡，正面中景"
	imageModel := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]string{"name": "绘图", "model": "drawing", "base_url": "https://example.com/v1", "secret": "draw-key"}, 200))
	generated := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]any{"model_id": imageModel.ID, "count": 2, "scenes": plan.Scenes}, 202))
	drawJob, _ := store.Get[domain.Job](a.Store.DB, "jobs", generated["job_id"])
	series, _ := jobImageSeries(drawJob)
	if !reflect.DeepEqual(series.Scenes, plan.Scenes) {
		t.Fatal("user edits lost before generation")
	}
	if calls != 1 {
		t.Fatal("unexpected paid request")
	}
}

func TestImagePlanInvalidOutputNeverFillsScenes(t *testing.T) {
	for _, output := range []string{`{}`, `{"scenes":["one"]}`, `{"scenes":["one",""]}`, `{"scenes":["one","two"],"error":"reference_unavailable"}`, `not json`, `{"scenes":["one","` + strings.Repeat("字", 1001) + `"]}`} {
		t.Run(output[:min(len(output), 40)], func(t *testing.T) {
			a := testApp(t)
			p, m := planFixture(t, a, false)
			r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/plan-images", map[string]any{"model_id": m.ID, "count": 2, "copy_text": "画面依据"}, 202))
			j, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
			original := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = original })
			http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) { return planReply(output), nil })
			if _, err := a.execute(j); err == nil {
				t.Fatal("accepted invalid output")
			}
			got, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
			if got.Payload["plan"] != nil {
				t.Fatal("invalid result filled")
			}
		})
	}
}

func TestImagePlanValidationHashAndSingleImage(t *testing.T) {
	a := testApp(t)
	p, m := planFixture(t, a, false)
	ref := sampleImage(t, a)
	endpoint := "/rewrites/" + p.ID + "/plan-images"
	request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 1, "reference_asset_ids": []string{ref.ID}}, 400)
	for _, count := range []any{0, 7, 1.5} {
		request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": count, "copy_text": "test"}, 400)
	}
	request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 1}, 400)
	r := decode[map[string]string](t, request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 1, "copy_text": "单图文案"}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return planReply(`{"scenes":["单张具体画面，暖光中景"]}`), nil
	})
	if _, err := a.execute(j); err != nil {
		t.Fatal(err)
	}
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	j.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "PUT", "/rewrite-models/"+m.ID, map[string]any{"name": "可看图", "model": "vision", "base_url": "https://example.com/v1", "vision": true}, 200)
	r = decode[map[string]string](t, request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "count": 1, "reference_asset_ids": []string{ref.ID}}, 202))
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	if err := os.WriteFile(filepath.Join(a.Config.DataDir, "media", ref.Path), seriesPNG(t, 99), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.execute(j); err == nil || calls != 1 {
		t.Fatal("changed reference sent to paid model", err, calls)
	}
	j.State = "failed"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/jobs/"+j.ID+"/retry", nil, 409)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 200)
	if _, err := store.Get[domain.Service](a.Store.DB, "settings", "image-plan-job-"+j.ID); err == nil {
		t.Fatal("secret snapshot left behind")
	}
}
