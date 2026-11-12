package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestWorkflowVideoScriptFreezesContextAndReusesRequest(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	confirmTestAccount(t, a, p.ID)
	base := "/rewrites/" + p.ID
	w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "手冲的早晨"}, 200))
	request(t, a, "POST", base+"/copies/confirm", map[string]any{"title_key": w.Title.Key, "body": "从磨豆到缓慢注水，记录咖啡香。", "topics": []string{"手冲咖啡"}}, 200)
	setTestWorkflowPrompt(t, a, "video-script", "视频管理员脚本原则")
	model, err := a.saveModelFor("video-script", modelSaveRequest{rewriteModel: rewriteModel{Name: "DeepSeek", Service: domain.Service{Model: "deepseek-chat", BaseURL: "https://example.com/v1", Secret: "script-test-secret"}}}, "")
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"model_id": model.ID, "duration": 8, "request_id": "workflow-script-request"}
	created := decode[map[string]string](t, request(t, a, "POST", base+"/workflow/video-script", input, 202))
	same := decode[map[string]string](t, request(t, a, "POST", base+"/workflow/video-script", input, 202))
	if same["job_id"] != created["job_id"] {
		t.Fatal("duplicate script task")
	}
	input["duration"] = 9
	request(t, a, "POST", base+"/workflow/video-script", input, 409)
	input["request_id"] = "another-script-request"
	request(t, a, "POST", base+"/workflow/video-script", input, 409)
	setTestWorkflowPrompt(t, a, "video-script", "后来修改的策略")
	request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "后来修改的标题"}, 200)
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
	calls := 0
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		raw := jsonString(body)
		for _, value := range []string{"手冲的早晨", "从磨豆到缓慢注水", "手冲咖啡", "独立咖啡师", "视频管理员脚本原则", "8秒"} {
			if !strings.Contains(raw, value) {
				t.Fatalf("missing frozen input %q", value)
			}
		}
		if strings.Contains(raw, "后来修改") {
			t.Fatal("queued script input changed")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"script\":\"0-4秒：磨豆特写；4-8秒：缓慢注水，字幕：早晨的咖啡香。\"}"}}]}`))}, nil
	})
	if _, err := a.execute(job); err != nil {
		t.Fatal(err)
	}
	if _, err := a.execute(job); err != nil || calls != 1 {
		t.Fatal("script retry repeated provider request", calls, err)
	}
	saved, _ := store.Get[domain.Job](a.Store.DB, "jobs", job.ID)
	text := asString(saved.Payload["generated_script"])
	if !strings.Contains(text, "0-4秒") {
		t.Fatal("script not persisted")
	}
	public := string(request(t, a, "GET", "/jobs", nil, 200))
	if strings.Contains(public, "script-test-secret") {
		t.Fatal("script secret leaked")
	}
	if !strings.Contains(public, "generated_script") {
		t.Fatal("script result unavailable to refreshed clients")
	}
	request(t, a, "POST", base+"/workflow/drafts/video-script", map[string]any{"revision": 0, "data": map[string]any{"text": text}}, 200)
	source := nativeVideoFixture(t, a, p)
	videoModel := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]any{"name": "视频", "base_url": "https://example.com/api/v3", "model": "doubao-seedance-2-5-260628", "secret": "video-test-secret"}, 200))
	videoInput := map[string]any{"model_id": videoModel.ID, "reference_asset_ids": []string{source.ID}, "quality": "720p", "ratio": "9:16", "duration": 8, "count": 1, "audio": true, "script": text, "request_id": "scripted-video-request"}
	videoReply := decode[map[string]string](t, request(t, a, "POST", base+"/workflow/video", videoInput, 202))
	videoJob, _ := store.Get[domain.Job](a.Store.DB, "jobs", videoReply["job_id"])
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method == "GET" {
			return nil, errors.New("fixture polling stopped")
		}
		data, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(data), text) {
			t.Fatal("video request lost generated script")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"scripted-remote-task"}`))}, nil
	})
	if _, err := a.execute(videoJob); err == nil {
		t.Fatal("expected fixture polling interruption")
	}
	generated := source
	generated.ID, generated.ProjectID, generated.Source = ID(), p.ID, "generated"
	if err := store.Put(a.Store.DB, "assets", generated.ID, generated); err != nil {
		t.Fatal(err)
	}
	videoJob.Result = generated.ID
	if err := store.Put(a.Store.DB, "jobs", videoJob.ID, videoJob); err != nil {
		t.Fatal(err)
	}
	current, _ := a.readWorkflow(p.ID)
	if err := a.validateWorkflowMediaSelection(p, current, "video", []string{generated.ID}); err != nil {
		t.Fatal(err)
	}
	request(t, a, "POST", base+"/workflow/drafts/video-script", map[string]any{"revision": 1, "data": map[string]any{"text": "修改后的新脚本"}}, 200)
	current, _ = a.readWorkflow(p.ID)
	if err := a.validateWorkflowMediaSelection(p, current, "video", []string{generated.ID}); !errors.Is(err, errWorkflowStageStale) {
		t.Fatal("old video remained selectable after script edit", err)
	}
}
