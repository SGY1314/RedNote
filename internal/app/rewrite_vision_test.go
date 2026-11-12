package app

import (
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestRewriteVisionOfficialCapabilitiesAndCustomEndpoints(t *testing.T) {
	for _, tc := range []struct {
		base, model string
		flag, want  bool
		capability  string
	}{
		{"https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", true, false, "text"},
		{"https://ws-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "qwen-vl-plus", false, true, "image"},
		{"https://dashscope.aliyuncs.com/compatible-mode/v1", "Qwen-VL-Max", false, true, "image"},
		{"https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.8-max", false, true, "video"},
		{"https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.8-max-0902", false, true, "video"},
		{"https://custom.example/v1", "qwen-plus", true, true, ""},
		{"https://dashscope.aliyuncs.com.evil.example/v1", "qwen-vl-plus", false, false, ""},
		{"https://dashscope.aliyuncs.com/compatible-mode/v1", "custom-vision", true, true, ""},
	} {
		m := rewriteModel{Vision: tc.flag, VisionCapability: "image", Service: domain.Service{BaseURL: tc.base, Model: tc.model}}
		normalizeRewriteVision(&m)
		if m.Vision != tc.want || m.VisionCapability != tc.capability {
			t.Fatalf("%s %s capability mismatch", tc.base, tc.model)
		}
	}
}

func TestImagePlanTextModelCannotBeEnabledByCheckboxOrRetried(t *testing.T) {
	a := testApp(t)
	p, _ := planFixture(t, a, false)
	base := "https://dashscope.aliyuncs.com/compatible-mode/v1"
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]any{"name": "文字", "model": "qwen-plus", "base_url": base, "secret": "fixture", "vision": true}, 200))
	if m.Vision || m.VisionCapability != "text" {
		t.Fatal("checkbox enabled vision on text model")
	}
	ref := sampleImage(t, a)
	r := request(t, a, "POST", "/rewrites/"+p.ID+"/plan-images", map[string]any{"model_id": m.ID, "count": 1, "reference_asset_ids": []string{ref.ID}}, 400)
	if !strings.Contains(string(r), "仅支持文字") {
		t.Fatal("missing specific recovery guidance")
	}
	vision := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]any{"name": "看图", "model": "qwen-vl-plus", "base_url": base, "secret": "fixture"}, 200))
	if !vision.Vision {
		t.Fatal("known vision model still requires checkbox")
	}
	created := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/plan-images", map[string]any{"model_id": vision.ID, "count": 1, "reference_asset_ids": []string{ref.ID}}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
	svc, _ := store.Get[domain.Service](a.Store.DB, "settings", "image-plan-job-"+j.ID)
	svc.Model = "qwen-plus" // Simulate an older queued task with a mistaken capability flag.
	store.Put(a.Store.DB, "settings", "image-plan-job-"+j.ID, svc)
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		t.Fatal("text-only task sent a paid request")
		return nil, nil
	})
	if _, err := a.execute(j); err == nil || !strings.Contains(err.Error(), "重新规划") {
		t.Fatal("old task not blocked", err)
	}
}

func TestExplicitPlanningInputCapabilitySurvivesSaveAndReload(t *testing.T) {
	a := testApp(t)
	p, _ := planFixture(t, a, false)
	store.Put(a.Store.DB, "creation_workflows", p.ID, creationWorkflow{ID: p.ID, Title: workflowTitle{Key: "title"}, Copy: workflowCopy{Key: "copy", TitleKey: "title", Body: "已确认文案"}})
	img := sampleImage(t, a)
	for _, scope := range []string{"video-script", "image-plan"} {
		model, err := a.saveModelFor(scope, modelSaveRequest{rewriteModel: rewriteModel{Name: "多模态规划", InputCapability: "video", Service: domain.Service{Model: "custom-omni", BaseURL: "https://fixture.example/v1", Secret: "fixture"}}}, "")
		if err != nil {
			t.Fatal(err)
		}
		if !model.Vision || model.InputCapability != "video" {
			t.Fatal("explicit capability lost")
		}
		models := decode[[]rewriteModel](t, request(t, a, "GET", "/"+scope+"-models", nil, 200))
		if len(models) != 1 || !models[0].Vision || models[0].VisionCapability != "video" || models[0].Secret != "" {
			t.Fatal("reload lost capability or exposed secret")
		}
		if scope == "video-script" {
			brief := continuousScript(15).Brief
			brief.ModelID = model.ID
			brief.ReferenceIDs = []string{img.ID}
			request(t, a, "POST", "/rewrites/"+p.ID+"/video/plan", brief, 202)
		}
	}
	if _, err := a.saveModelFor("video-script", modelSaveRequest{rewriteModel: rewriteModel{InputCapability: "invalid"}}, ""); err == nil {
		t.Fatal("invalid capability accepted")
	}
	m := rewriteModel{InputCapability: "text", Vision: true, Service: domain.Service{BaseURL: "https://fixture.example", Model: "custom"}}
	normalizeRewriteVision(&m)
	if m.Vision {
		t.Fatal("text override retained vision")
	}
}
