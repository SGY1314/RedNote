package app

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func accountTestFields() workflowAccountFields {
	return workflowAccountFields{Name: "清晨手记", Subject: "独立咖啡师", Positioning: "分享家庭手冲方法", Audience: "刚开始学习手冲的上班族", Style: "真诚克制的表达与温暖纪实画面"}
}

func confirmTestAccount(t *testing.T, a *App, id string) creationWorkflow {
	t.Helper()
	return decode[creationWorkflow](t, request(t, a, "POST", "/rewrites/"+id+"/workflow/account", struct {
		workflowAccountFields
		Revision int `json:"revision"`
	}{accountTestFields(), 0}, 200))
}

func TestWorkflowAccountDraftConfirmationSkipAndConflict(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID + "/workflow"
	fields := accountTestFields()
	fields.Name = "  " + fields.Name + "  "
	request(t, a, "POST", base+"/drafts/account", map[string]any{"revision": 0, "data": fields}, 200)
	w, _ := a.readWorkflow(p.ID)
	if w.AccountProfile.Status != "" || workflowAccountPrompt(w.AccountProfile) != "" {
		t.Fatal("unconfirmed draft influenced generation")
	}
	request(t, a, "POST", base+"/account", map[string]any{"account_name": "草稿过期", "revision": 0, "draft_revision": 0}, 409)
	confirmed := decode[creationWorkflow](t, request(t, a, "POST", base+"/account", map[string]any{"account_name": fields.Name, "account_subject": fields.Subject, "positioning": fields.Positioning, "audience": fields.Audience, "style": fields.Style, "revision": 0, "draft_revision": 1}, 200))
	if confirmed.AccountProfile.Status != "confirmed" || confirmed.AccountProfile.Name != strings.TrimSpace(fields.Name) || confirmed.AccountProfile.Revision != 1 || confirmed.AccountProfile.Key == "" {
		t.Fatal("confirmed profile not persisted", confirmed.AccountProfile)
	}
	loaded := decode[struct {
		Workflow creationWorkflow `json:"workflow"`
	}](t, request(t, a, "GET", base, nil, 200))
	if loaded.Workflow.AccountProfile != confirmed.AccountProfile || string(loaded.Workflow.Drafts["account"].Data) == "" {
		t.Fatal("profile or draft was lost after reload")
	}
	again := decode[creationWorkflow](t, request(t, a, "POST", base+"/account", struct {
		workflowAccountFields
		Revision int `json:"revision"`
	}{accountTestFields(), 1}, 200))
	if again.AccountProfile != confirmed.AccountProfile {
		t.Fatal("unchanged confirmation advanced the profile revision")
	}
	request(t, a, "POST", base+"/account", map[string]any{"account_name": "另一个标签页", "revision": 0}, 409)
	request(t, a, "POST", base+"/account", map[string]any{"revision": 1}, 400)
	request(t, a, "POST", base+"/account", map[string]any{"account_name": strings.Repeat("中", 101), "revision": 1}, 400)
	request(t, a, "POST", base+"/drafts/account", map[string]any{"revision": 1, "data": map[string]any{"style": strings.Repeat("中", 601)}}, 400)
	skipped := decode[creationWorkflow](t, request(t, a, "POST", base+"/account", map[string]any{"revision": 1, "draft_revision": 1, "skip": true}, 200))
	if skipped.AccountProfile.Status != "skipped" || skipped.AccountProfile.Revision != 2 || workflowAccountPrompt(skipped.AccountProfile) != "" || skipped.Drafts["account"].Revision != 1 {
		t.Fatal("skipping did not disable the context or removed the draft")
	}
	other := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]any{"name": "其他项目"}, 201))
	otherWorkflow, _ := a.readWorkflow(other.ID)
	if otherWorkflow.AccountProfile.Status != "" || len(otherWorkflow.Drafts) != 0 {
		t.Fatal("account details leaked into another project")
	}
}

func TestWorkflowAccountReachesEveryModelAndIsFrozen(t *testing.T) {
	for _, stage := range []string{"angle", "title", "copy", "image-plan", "image", "video-script", "video"} {
		t.Run(stage, func(t *testing.T) {
			a, p := stagedFixture(t)
			base := "/rewrites/" + p.ID
			confirmed := confirmTestAccount(t, a, p.ID)
			w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "手冲咖啡的早晨"}, 200))
			w = decode[creationWorkflow](t, request(t, a, "POST", base+"/copies/confirm", map[string]any{"body": "从磨豆、注水到品尝，分享一杯手冲咖啡。", "title_key": w.Title.Key}, 200))
			endpoint := map[string]string{"angle": "/angles/recommend", "title": "/titles/generate", "copy": "/copies/generate", "image-plan": "/plan-images", "image": "/generate-image", "video-script": "/video/plan", "video": "/video/generate"}[stage]
			input := map[string]any{"model_id": "initial"}
			switch stage {
			case "image-plan":
				input["count"], input["copy_text"] = 1, "确认文案"
			case "image":
				model := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]any{"name": "图片模型", "model": "image-fixture", "base_url": "https://example.com/v1", "secret": "fixture-key"}, 200))
				plan := decode[workflowImagePlan](t, request(t, a, "POST", base+"/image-plans/confirm", map[string]any{"copy_key": w.Copy.Key, "scenes": []string{"自然光下冲咖啡"}}, 201))
				input["model_id"], input["plan_id"], input["scenes"] = model.ID, plan.ID, plan.Scenes
			case "video-script":
				input["duration"], input["copy_text"] = 15, "确认文案"
			case "video":
				model := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]any{"name": "视频模型", "model": "doubao-seedance-2-5-260628", "base_url": "https://example.com/api/v3", "secret": "fixture-key"}, 200))
				script := videoScript{Title: "咖啡", Concept: "咖啡制作", Style: "温暖", Brief: videoBrief{CopyKey: w.Copy.Key, CopyText: "手冲咖啡", Duration: 15}, Shots: []directorShot{{5, "磨豆", "特写", "磨豆"}, {5, "注水", "推近", "注水"}, {5, "品尝", "拉远", "品尝"}}, SubtitlePlan: "按口播显示", Music: "轻音乐"}
				script = decode[videoScript](t, request(t, a, "POST", base+"/video/scripts", script, 201))
				request(t, a, "POST", base+"/video/scripts/"+script.ID+"/confirm", nil, 200)
				input["model_id"], input["script_id"] = model.ID, script.ID
			}
			created := decode[map[string]any](t, request(t, a, "POST", base+endpoint, input, 202))
			job, err := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"].(string))
			if err != nil {
				t.Fatal(err)
			}
			request(t, a, "POST", base+"/workflow/account", map[string]any{"revision": confirmed.AccountProfile.Revision, "skip": true}, 200)
			calls := 0
			previous := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = previous })
			http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				body, _ := io.ReadAll(req.Body)
				for _, value := range []string{"清晨手记", "独立咖啡师", "分享家庭手冲方法", "刚开始学习手冲的上班族", "真诚克制的表达与温暖纪实画面"} {
					if !strings.Contains(string(body), value) {
						t.Fatalf("%s model request lost the confirmed account field %q: %s", stage, value, body)
					}
				}
				switch stage {
				case "angle":
					return planReply(`{"angles":[{"name":"方法分享","description":"从手冲步骤切入"},{"name":"工具选择","description":"从磨豆工具切入"},{"name":"日常观察","description":"从早晨仪式切入"}]}`), nil
				case "title":
					return planReply(`{"titles":["清晨的一杯手冲","我的磨豆小技巧","给上班族的手冲指南"]}`), nil
				case "copy":
					return planReply(`{"copies":[{"body":"第一份咖啡经验","topics":["咖啡"]},{"body":"第二份咖啡经验","topics":[]},{"body":"第三份咖啡经验","topics":[]}]}`), nil
				case "image-plan":
					return planReply(`{"scenes":["自然光洒在书桌上，咖啡师双手缓缓注水，暖色纪实近景"]}`), nil
				case "video-script":
					return planReply(`{"title":"咖啡制作","concept":"从磨豆到品尝","style":"温暖纪实","shots":[{"duration":5,"visual":"磨豆","camera":"近景","narration":"磨豆"},{"duration":5,"visual":"注水","camera":"推进","narration":"注水"},{"duration":5,"visual":"品尝","camera":"拉远","narration":"品尝"}],"subtitle_plan":"按口播显示","music":"轻音乐"}`), nil
				default:
					return &http.Response{StatusCode: 400, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"fixture stops provider submission"}`))}, nil
				}
			})
			_, err = a.execute(job)
			if stage == "image" || stage == "video" {
				if err == nil {
					t.Fatal("provider rejection should stop generation")
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if calls != 1 {
				t.Fatalf("expected one model call, got %d", calls)
			}
		})
	}
}

func TestWorkflowAccountSkippedContextIsEmpty(t *testing.T) {
	a, p := stagedFixture(t)
	request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/drafts/account", map[string]any{"revision": 0, "data": accountTestFields()}, 200)
	request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/account", map[string]any{"revision": 0, "skip": true}, 200)
	created := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/titles/generate", map[string]any{"model_id": "initial"}, 202))
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
	if asString(job.Payload["account_context"]) != "" || strings.Contains(jsonString(job), "清晨手记") {
		t.Fatal("skipped account draft influenced a new task")
	}
}
