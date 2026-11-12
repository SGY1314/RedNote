package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestUserPromptChoiceReplacesOrDisablesTemplateAndFreezes(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		t.Run(map[bool]string{true: "custom", false: "disabled"}[enabled], func(t *testing.T) {
			a, p := stagedFixture(t)
			setTestWorkflowPrompt(t, a, "title", "ADMIN-MUST-NOT-APPEAR")
			request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/drafts/title", map[string]any{"revision": 0, "data": map[string]any{"system_prompt_choice": workflowPromptChoice{Enabled: enabled, Text: "MY-CREATIVE-PROMPT"}}}, 200)
			created := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/titles/generate", map[string]any{"model_id": "initial", "count": 3}, 202))
			request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/drafts/title", map[string]any{"revision": 1, "data": map[string]any{"system_prompt_choice": workflowPromptChoice{Enabled: true, Text: "LATER-EDIT"}}}, 200)
			job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
			previous := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = previous })
			http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(req.Body)
				text := string(raw)
				if strings.Contains(text, "ADMIN-MUST-NOT-APPEAR") || strings.Contains(text, "LATER-EDIT") {
					t.Fatal("unselected template or later edit sent to model")
				}
				if strings.Contains(text, "MY-CREATIVE-PROMPT") != enabled {
					t.Fatal("prompt switch not honored")
				}
				return planReply(`{"titles":["咖啡新日常","周末磨豆记","一杯手冲咖啡"]}`), nil
			})
			if _, err := a.runTitleRewrite(job); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestMediaPromptChoiceAndScriptDuration(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	for _, enabled := range []bool{true, false} {
		w, _ := a.readWorkflow(p.ID)
		raw, _ := json.Marshal(map[string]any{"system_prompt_choice": workflowPromptChoice{Enabled: enabled, Text: "CUSTOM-MEDIA"}})
		d := w.Drafts["image"]
		d.Data = raw
		w.Drafts["image"] = d
		store.Put(a.Store.DB, "creation_workflows", p.ID, w)
		snapshot, err := a.workflowMediaContext(p, "image", "fixture", nil, "", "2k", "3:4", 1)
		if err != nil {
			t.Fatal(err)
		}
		expected := ""
		if enabled {
			expected = "CUSTOM-MEDIA"
		}
		if snapshot.SystemPrompt != expected {
			t.Fatal("media prompt switch ignored", snapshot.SystemPrompt)
		}
	}
	w, _ := a.readWorkflow(p.ID)
	raw, _ := json.Marshal(map[string]any{"duration": 13, "system_prompt_choice": workflowPromptChoice{Enabled: false, Text: "DISABLED-SCRIPT-TEMPLATE"}})
	d := w.Drafts["video-script"]
	d.Data = raw
	w.Drafts["video-script"] = d
	store.Put(a.Store.DB, "creation_workflows", p.ID, w)
	model, err := a.saveModelFor("video-script", modelSaveRequest{rewriteModel: rewriteModel{Name: "脚本模型", Service: domain.Service{Model: "fixture", BaseURL: "https://example.com/v1", Secret: "test"}}}, "")
	if err != nil {
		t.Fatal(err)
	}
	created := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/video-script", map[string]any{"model_id": model.ID, "duration": 13, "request_id": "script-duration-choice"}, 202))
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
	if promptRevision(job.Payload["duration"]) != 13 || asString(job.Payload["system_prompt"]) != "" {
		t.Fatal("script duration or disabled prompt not frozen")
	}
}
