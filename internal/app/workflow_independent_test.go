package app

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestIndependentWorkflowGenerationUsesSourceWithoutConfirmingIt(t *testing.T) {
	for _, stage := range []string{"copy", "image-plan", "image", "video-script", "video"} {
		t.Run(stage, func(t *testing.T) {
			a, p := stagedFixture(t)
			base := "/rewrites/" + p.ID
			basis, err := a.storedWorkflowBasis(p.ID)
			if err != nil || basis.Title.Text != "唯一参考标题" || basis.Copy.Body != "不能出现在标题请求中的原文标记" || basis.Copy.Key == "" {
				t.Fatal("original note is not available as the default basis", basis, err)
			}
			input := map[string]any{"model_id": "initial", "count": 1}
			endpoint := map[string]string{"copy": "/copies/generate", "image-plan": "/plan-images", "image": "/generate-image", "video-script": "/video/plan", "video": "/video/generate"}[stage]
			switch stage {
			case "image":
				plan := decode[workflowImagePlan](t, request(t, a, "POST", base+"/image-plans/confirm", map[string]any{"copy_key": basis.Copy.Key, "scenes": []string{"自然光照在桌面上的一杯咖啡"}}, 201))
				model := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]any{"name": "图片模型", "model": "image-fixture", "base_url": "https://example.com/v1", "secret": "fixture-key"}, 200))
				input["plan_id"], input["scenes"], input["model_id"] = plan.ID, plan.Scenes, model.ID
			case "video-script":
				input["duration"] = 15
			case "video":
				script := videoScript{Title: "咖啡", Concept: "完整故事", Style: "自然", Brief: videoBrief{CopyKey: basis.Copy.Key, CopyText: a.workflowCopyText(p.ID), Duration: 15}, Shots: []directorShot{{5, "磨豆", "特写", "磨豆"}, {5, "注水", "推进", "注水"}, {5, "品尝", "拉远", "品尝"}}, SubtitlePlan: "逐句字幕", Music: "轻音乐"}
				script = decode[videoScript](t, request(t, a, "POST", base+"/video/scripts", script, 201))
				if script.Brief.CopyKey != basis.Copy.Key || !strings.Contains(script.Brief.CopyText, basis.Title.Text) || !strings.Contains(script.Brief.CopyText, basis.Copy.Body) {
					t.Fatal("video script lost its original-note basis")
				}
				request(t, a, "POST", base+"/video/scripts/"+script.ID+"/confirm", nil, 200)
				model := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]any{"name": "视频模型", "model": "doubao-seedance-2-5-260628", "base_url": "https://example.com/api/v3", "secret": "fixture-key"}, 200))
				input["script_id"], input["model_id"] = script.ID, model.ID
			}
			created := decode[map[string]string](t, request(t, a, "POST", base+endpoint, input, 202))
			job, err := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
			if err != nil {
				t.Fatal(err)
			}
			previous := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = previous })
			calls := 0
			http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				body, _ := io.ReadAll(req.Body)
				if stage != "video" {
					for _, text := range []string{basis.Title.Text, basis.Copy.Body, "原始话题"} {
						if !strings.Contains(string(body), text) {
							t.Fatalf("%s generation lost the source context %q", stage, text)
						}
					}
				}
				switch stage {
				case "copy":
					return planReply(`{"copies":[{"body":"独立生成的完整正文","topics":["咖啡"]}]}`), nil
				case "image-plan":
					return planReply(`{"scenes":["自然光下的一杯咖啡，温暖纪实近景"]}`), nil
				case "video-script":
					return planReply(`{"title":"咖啡制作","concept":"从磨豆到品尝","style":"温暖","shots":[{"duration":5,"visual":"磨豆","camera":"特写","narration":"磨豆"},{"duration":5,"visual":"注水","camera":"推进","narration":"注水"},{"duration":5,"visual":"品尝","camera":"拉远","narration":"品尝"}],"subtitle_plan":"逐句显示","music":"轻音乐"}`), nil
				default:
					return &http.Response{StatusCode: 400, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"fixture stops provider submission"}`))}, nil
				}
			})
			_, err = a.execute(job)
			if (stage == "image" || stage == "video") != (err != nil) || calls != 1 {
				t.Fatal("independent generation did not reach the expected model once", stage, calls, err)
			}
			w, _ := a.readWorkflow(p.ID)
			if w.AccountProfile.Status != "" || w.Title.Key != "" || w.Copy.Key != "" {
				t.Fatal("source defaults were written as user confirmations", w)
			}
		})
	}
}

func TestIndependentStagePublishAndLaterEditsPreserveSnapshots(t *testing.T) {
	for _, stage := range []string{"copy", "image", "video"} {
		t.Run(stage, func(t *testing.T) {
			a, p, source := stageSourceFixture(t)
			basis, _ := a.storedWorkflowBasis(p.ID)
			media := &domain.VersionMedia{Kind: "image", AssetIDs: source.AssetIDs, CoverID: source.AssetIDs[0]}
			if stage == "video" {
				data, err := os.ReadFile(filepath.Join("..", "..", "web", "tests", "fixtures", "reference-preview.webm"))
				if err != nil {
					t.Fatal(err)
				}
				video := domain.Asset{ID: ID(), Kind: "video", Status: "ready", Source: "upload", MIME: "video/webm", Path: "independent.webm", Size: int64(len(data)), Duration: 1.2}
				if err = os.WriteFile(filepath.Join(a.Config.DataDir, "media", video.Path), data, 0600); err != nil {
					t.Fatal(err)
				}
				if err = store.Put(a.Store.DB, "assets", video.ID, video); err != nil {
					t.Fatal(err)
				}
				media = &domain.VersionMedia{Kind: "video", AssetIDs: []string{video.ID}, CoverID: source.AssetIDs[0]}
			}
			input := workflowStageRequest{Step: stage, TitleKey: basis.Title.Key, CopyKey: basis.Copy.Key, Text: "独立确认的新正文", Topics: []string{"新话题"}, Media: media, Publish: true}
			reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", input, 201))
			if reply.Workflow.Title.Key != "" || reply.Workflow.AccountProfile.Status != "" || reply.Version.Title != source.Title || len(reply.Publications) != 1 {
				t.Fatal("starting out of order created an upstream confirmation or lost the original title")
			}
			if stage == "copy" {
				if reply.Version.Body != input.Text || !slices.Equal(reply.Version.Topics, input.Topics) {
					t.Fatal("copy-first version lost selected content")
				}
			} else if reply.Workflow.Copy.Key != "" || reply.Version.Body != source.Body || !slices.Equal(reply.Version.Topics, source.Topics) {
				t.Fatal("media-first version changed the original copy")
			}
			plan := decode[workflowImagePlan](t, request(t, a, "POST", "/rewrites/"+p.ID+"/image-plans/confirm", map[string]any{"copy_key": a.workflowCopyKey(p.ID), "scenes": []string{"完整画面"}}, 201))
			request(t, a, "POST", "/rewrites/"+p.ID+"/titles/confirm", map[string]any{"text": "后来确认的新标题"}, 200)
			if err := a.workflowRequiresCopy(p.ID); err != nil {
				t.Fatal("later title confirmation locked other modules", err)
			}
			if err := a.workflowRequiresImagePlan(p.ID, plan.ID, plan.Scenes); err == nil {
				t.Fatal("outdated image planning inputs were accepted")
			}
			request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", input, 409)
			publication := confirmPreparedTest(t, a, reply.Publications[0])
			if publication.Title != source.Title || publication.Body != reply.Version.Body {
				t.Fatal("later title confirmation changed a saved publication")
			}
		})
	}
}
