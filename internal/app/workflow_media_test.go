package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
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

func TestDirectImageUsesOriginalsSavedCopyAndOutputParameters(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	setTestWorkflowPrompt(t, a, "image", "图片管理员冻结策略")
	confirmTestAccount(t, a, p.ID)
	base := "/rewrites/" + p.ID
	w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "新标题"}, 200))
	w = decode[creationWorkflow](t, request(t, a, "POST", base+"/copies/confirm", map[string]any{"title_key": w.Title.Key, "body": "新文案中的手冲过程", "topics": []string{"手冲"}}, 200))
	model := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]any{"name": "原图仿写", "base_url": "https://example.com/v1", "model": "image-fixture", "secret": "image-key", "reference_mode": "generations_image"}, 200))
	input := map[string]any{"direct": true, "model_id": model.ID, "reference_asset_ids": source.AssetIDs, "requirements": "保留主体，使用柔和光线", "quality": "2k", "ratio": "4:3", "count": 2, "request_id": "image-request-1"}
	first := decode[map[string]string](t, request(t, a, "POST", base+"/generate-image", input, 202))
	setTestWorkflowPrompt(t, a, "image", "图片后来修改的策略")
	again := decode[map[string]string](t, request(t, a, "POST", base+"/generate-image", input, 202))
	if first["job_id"] != again["job_id"] {
		t.Fatal("duplicate image task")
	}
	input["quality"] = "4k"
	request(t, a, "POST", base+"/generate-image", input, 409)
	input["quality"] = "2k"
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", first["job_id"])
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		prompt := asString(body["prompt"])
		for _, value := range []string{workflowImagePrompt, "图片管理员冻结策略", "新文案中的手冲过程", "保留主体，使用柔和光线", "独立咖啡师"} {
			if !strings.Contains(prompt, value) {
				t.Fatalf("image prompt missing %q", value)
			}
		}
		if strings.Contains(prompt, "图片后来修改的策略") {
			t.Fatal("queued image task changed with admin edit")
		}
		if body["size"] != "2048x1536" || len(body["image"].([]any)) != len(source.AssetIDs) {
			t.Fatal("image parameters or original references lost", body["size"])
		}
		response, _ := json.Marshal(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(seriesPNG(t, uint8(calls*40)))}}})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(response))}, nil
	})
	result, err := a.execute(job)
	if err != nil || calls != 2 {
		t.Fatal("direct image generation failed", calls, err)
	}
	stored, _ := store.Get[domain.Job](a.Store.DB, "jobs", job.ID)
	series, _ := jobImageSeries(stored)
	stage := workflowStageRequest{Step: "image", TitleKey: w.Title.Key, CopyKey: w.Copy.Key, Media: &domain.VersionMedia{Kind: "image", AssetIDs: []string{result}}}
	request(t, a, "POST", base+"/workflow/stage", stage, 201)
	if len(series.Completed) != 2 {
		t.Fatal("missing generated image results")
	}
	input["requirements"] = "修改过的要求"
	request(t, a, "POST", base+"/workflow/drafts/image", map[string]any{"revision": 0, "data": input}, 200)
	request(t, a, "POST", base+"/workflow/stage", stage, 409)
	stage.UseProjectImageResults = true
	selected := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", stage, 200))
	if !slices.Equal(selected.Version.Media.AssetIDs, []string{result}) || len(selected.Publications) != 0 {
		t.Fatal("earlier generated image could not be selected from the project timeline")
	}
	public := string(request(t, a, "GET", "/jobs", nil, 200))
	if strings.Contains(public, "image-key") {
		t.Fatal("model secret leaked")
	}
}

func nativeVideoFixture(t *testing.T, a *App, p domain.Project) domain.Asset {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "web", "tests", "fixtures", "native-reference.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	asset := domain.Asset{ID: ID(), Name: "原视频", Kind: "video", Source: "collection", RevisionID: p.RevisionID, RemoteURL: "https://sns-video-bd.xhscdn.com/native-reference.mp4?sign=fixture-private", CreatedAt: Now()}
	if err = a.ingest(bytes.NewReader(data), &asset); err != nil {
		t.Fatal(err)
	}
	if err = store.Put(a.Store.DB, "assets", asset.ID, asset); err != nil {
		t.Fatal(err)
	}
	return asset
}

func TestDirectVideoUsesScriptOnlyAndResumesSameTask(t *testing.T) {
	for _, provider := range []string{"ark", "wan"} {
		t.Run(provider, func(t *testing.T) {
			a, p := stagedFixture(t)
			setTestWorkflowPrompt(t, a, "video", "视频管理员冻结策略")
			confirmTestAccount(t, a, p.ID)
			source := nativeVideoFixture(t, a, p)
			base := "/rewrites/" + p.ID
			w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "不要传给视频模型的标题"}, 200))
			request(t, a, "POST", base+"/copies/confirm", map[string]any{"title_key": w.Title.Key, "body": "不要传给视频模型的文案"}, 200)
			url, model := "https://example.com/api/v3", "doubao-seedance-2-5-260628"
			if provider == "wan" {
				url, model = "https://fixture.cn-beijing.maas.aliyuncs.com/api/v1", "wan3.0-video"
			}
			configured := decode[rewriteModel](t, request(t, a, "POST", "/video-models", map[string]any{"name": "原视频仿写", "base_url": url, "model": model, "secret": "native-secret"}, 200))
			input := map[string]any{"model_id": configured.ID, "reference_asset_ids": []string{source.ID}, "requirements": "保持动作节奏，改成暖色", "script": "0-8秒：按脚本展示暖色咖啡镜头。", "quality": "1080p", "ratio": "16:9", "duration": 8, "count": 2, "audio": false, "request_id": "video-request-1"}
			unavailable := source
			unavailable.DeletedAt, unavailable.RemoteURL = Now(), ""
			if err := store.Put(a.Store.DB, "assets", unavailable.ID, unavailable); err != nil {
				t.Fatal(err)
			}
			text := input["script"]
			input["script"] = " "
			request(t, a, "POST", base+"/workflow/video", input, 400)
			input["script"] = text
			created := decode[map[string]string](t, request(t, a, "POST", base+"/workflow/video", input, 202))
			setTestWorkflowPrompt(t, a, "video", "视频后来修改的策略")
			again := decode[map[string]string](t, request(t, a, "POST", base+"/workflow/video", input, 202))
			if created["job_id"] != again["job_id"] {
				t.Fatal("duplicate paid video task")
			}
			request(t, a, "POST", base+"/workflow/account", map[string]any{"revision": 1, "skip": true}, 200)
			job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
			public := string(request(t, a, "GET", "/jobs", nil, 200))
			if strings.Contains(public, "fixture-private") || strings.Contains(public, "native-secret") {
				t.Fatal("video reference or secret leaked")
			}
			previous := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = previous })
			posts, gets := 0, 0
			http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method == "POST" {
					posts++
					var body map[string]any
					json.NewDecoder(r.Body).Decode(&body)
					raw := jsonString(body)
					for _, value := range []string{"视频管理员冻结策略", "0-8秒：按脚本展示暖色咖啡镜头。", "保持动作节奏，改成暖色"} {
						if !strings.Contains(raw, value) {
							t.Fatalf("native video request missing %q", value)
						}
					}
					if strings.Contains(raw, source.RemoteURL) || strings.Contains(raw, "reference_video") || strings.Contains(raw, "独立咖啡师") {
						t.Fatal("script-only generation leaked unrelated reference or account context")
					}
					if strings.Contains(raw, "视频后来修改的策略") {
						t.Fatal("queued video task changed with admin edit")
					}
					if strings.Contains(raw, "不要传给视频模型") {
						t.Fatal("video unexpectedly used copy or title")
					}
					if provider == "wan" {
						params := body["parameters"].(map[string]any)
						if params["duration"] != float64(8) || params["ratio"] != "16:9" || params["resolution"] != "1080P" || params["audio"] != false {
							t.Fatal("wan properties lost")
						}
						return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"output":{"task_id":"native-task","task_status":"PENDING"}}`))}, nil
					}
					if body["duration"] != float64(8) || body["ratio"] != "16:9" || body["resolution"] != "1080p" || body["generate_audio"] != false || body["omni_reference_task_type"] != nil {
						t.Fatal("ark properties lost")
					}
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"native-task"}`))}, nil
				}
				gets++
				return nil, errors.New("fixture polling connection interrupted")
			})
			if _, err := a.execute(job); err == nil {
				t.Fatal("expected polling interruption")
			}
			job, _ = store.Get[domain.Job](a.Store.DB, "jobs", job.ID)
			if !videoCanResume(job) {
				t.Fatal("known native video task cannot resume")
			}
			if _, err := a.execute(job); err == nil || posts != 1 || gets != 2 {
				t.Fatal("refresh or recovery repeated provider submission", posts, gets, err)
			}
			input["request_id"] = "video-request-2"
			request(t, a, "POST", base+"/workflow/video", input, 409)
		})
	}
}

func TestDirectMediaAcceptsUploadedReference(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	original, err := store.Get[domain.Asset](a.Store.DB, "assets", source.AssetIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	upload := original
	upload.ID, upload.Source, upload.RevisionID = ID(), "upload", ""
	if err = store.Put(a.Store.DB, "assets", upload.ID, upload); err != nil {
		t.Fatal(err)
	}
	_, err = a.workflowMediaContext(p, "image", "fixture", []string{upload.ID}, "", "2k", "3:4", 1)
	if err != nil {
		t.Fatal("uploaded reference rejected", err)
	}
	upload.Source = "collection"
	if err = store.Put(a.Store.DB, "assets", upload.ID, upload); err != nil {
		t.Fatal(err)
	}
	if _, err = a.workflowMediaContext(p, "image", "fixture", []string{upload.ID}, "", "2k", "3:4", 1); err == nil {
		t.Fatal("unrelated collected reference accepted")
	}
	upload.Source, upload.LibraryState = "generated", "result"
	if err = store.Put(a.Store.DB, "assets", upload.ID, upload); err != nil {
		t.Fatal(err)
	}
	if _, err = a.workflowMediaContext(p, "image", "fixture", []string{upload.ID}, "", "2k", "3:4", 1); err == nil {
		t.Fatal("unsaved result accepted as library reference")
	}
}
