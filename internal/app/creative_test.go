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

func TestCreativeAngleSuggestionsRequireSelection(t *testing.T) {
	a := testApp(t)
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "测试", "model": "fixture-model", "base_url": "https://example.com/v1", "secret": "fixture-key"}, 200))
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "角度测试"}, 201))
	input := map[string]any{"model_id": m.ID, "copy_text": "桌面整理", "audience": "上班族", "creative": domain.CreativeSettings{Angle: "减少重复收拾"}}
	queued := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/suggest-angles", input, 202))
	request(t, a, "POST", "/rewrites/"+p.ID+"/suggest-angles", input, 409)
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", queued["job_id"])
	if j.Kind != "angle_suggest" {
		t.Fatal(j.Kind)
	}
	if strings.Contains(asString(j.Payload["instructions"]), rewriteWritingRules) {
		t.Fatal("angle suggestions must not receive the post-writing output contract")
	}
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		raw, _ := io.ReadAll(r.Body)
		if strings.Contains(string(raw), "response_format") {
			t.Fatal("topic suggestions still force JSON mode")
		}
		for _, s := range []string{"上班族", "减少重复收拾", "桌面整理", "不编造"} {
			if !strings.Contains(string(raw), s) {
				t.Fatalf("prompt missing %s", s)
			}
		}
		body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "1. 常用物品就近放置\n2. 减少桌面取物障碍\n3. 整理后如何维持"}, "finish_reason": "stop"}}})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(body)))}, nil
	})
	if _, err := a.runAngleSuggestions(j); err != nil {
		t.Fatal(err)
	}
	if _, err := a.runAngleSuggestions(j); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("recovered completed suggestions called model again")
	}
	saved, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if len(texts(saved.Payload["angles"])) != 3 {
		t.Fatal("missing options")
	}
	versions, _ := store.List[domain.Version](a.Store.DB, "versions")
	if len(versions) != 0 {
		t.Fatal("suggestions created a copy version without user selection")
	}
}

func TestCreativeTopicBeforeCopy(t *testing.T) {
	for _, withReference := range []bool{false, true} {
		a := testApp(t)
		m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "测试", "model": "fixture", "base_url": "https://example.com/v1", "secret": "fixture-key"}, 200))
		p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "主题测试"}, 201))
		p.Sources = []domain.Source{{ID: "selected", Label: "参考帖子", Text: "收纳盒使用观察"}, {ID: "excluded", Text: "不应传给模型的资料"}}
		if err := store.Put(a.Store.DB, "projects", p.ID, p); err != nil {
			t.Fatal(err)
		}
		ids := []string{}
		if withReference {
			ids = append(ids, "selected")
		}
		input := map[string]any{"model_id": m.ID, "source_ids": ids, "creative": domain.CreativeSettings{Topic: "租房桌面的整理"}}
		for _, endpoint := range []string{"suggest-angles", "generate"} {
			q := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/"+endpoint, input, 202))
			j, err := store.Get[domain.Job](a.Store.DB, "jobs", q["job_id"])
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(asString(j.Payload["instructions"]), "租房桌面的整理") || jobCreative(j).Topic != "租房桌面的整理" {
				t.Fatal("theme missing from generation snapshot")
			}
			if strings.Contains(asString(j.Payload["source"]), "不应传给模型") || strings.Contains(asString(j.Payload["source"]), "收纳盒使用观察") != withReference {
				t.Fatal("selected references were not respected")
			}
			if endpoint != "generate" {
				continue
			}
			old := http.DefaultTransport
			http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
				raw, _ := io.ReadAll(r.Body)
				if !strings.Contains(string(raw), "租房桌面的整理") {
					t.Fatal("model did not receive topic")
				}
				body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": `{"title":"桌面整理","body":"从常用的物品开始整理。","topics":[]}`}, "finish_reason": "stop"}}})
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(body)))}, nil
			})
			versionID, runErr := a.runRewrite(j)
			http.DefaultTransport = old
			if runErr != nil {
				t.Fatal(runErr)
			}
			v, err := store.Get[domain.Version](a.Store.DB, "versions", versionID)
			if err != nil || v.Creative == nil || v.Creative.Topic != "租房桌面的整理" || len(v.SourceSnapshot) != len(ids) {
				t.Fatal("version lost theme or references", err)
			}
		}
	}
}

func TestCreativeSettingsValidationAndMediumIsolation(t *testing.T) {
	c := &domain.CreativeSettings{Angle: "共享角度", ImageAngle: "图片单独角度", ImageHook: "detail", VideoHook: "question"}
	if err := validateCreative(c); err != nil {
		t.Fatal(err)
	}
	image := creativePrompt(c, "image")
	video := creativePrompt(c, "video")
	copy := creativePrompt(c, "text")
	if !strings.Contains(image, "图片单独角度") || !strings.Contains(image, "细节特写") || strings.Contains(image, "提问开场") {
		t.Fatal("image isolation")
	}
	if !strings.Contains(video, "共享角度") || !strings.Contains(video, "提问开场") || strings.Contains(video, "图片单独角度") {
		t.Fatal("video inheritance")
	}
	if !strings.Contains(copy, "共享角度") || strings.Contains(copy, "图片单独角度") {
		t.Fatal("copy isolation")
	}
	for _, bad := range []*domain.CreativeSettings{{ImageHook: "unsupported"}, {VideoHook: "custom"}, {Angle: strings.Repeat("字", 1001)}} {
		if validateCreative(bad) == nil {
			t.Fatal("accepted invalid creative settings")
		}
	}
	c.VideoHook = "custom"
	c.VideoCustom = "先扶住快倒下的杯子"
	if err := validateCreative(c); err != nil || !strings.Contains(creativePrompt(c, "video"), c.VideoCustom) {
		t.Fatal("custom hook missing", err)
	}
}

func TestCreativeVersionKeepsIndependentSettings(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "完整版本"}, 201))
	c := domain.CreativeSettings{Angle: "原角度", ImageHook: "detail", VideoHook: "action"}
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "标题", "body": "正文", "creative": c}, 201))
	c.Angle = "新角度"
	child := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"parent_id": v.ID, "title": "标题", "body": "正文", "creative": c}, 201))
	original, _ := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	if original.Creative.Angle != "原角度" || child.Creative.Angle != "新角度" {
		t.Fatal("version creative settings overwritten")
	}
	inherited := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"parent_id": v.ID, "title": "旧客户端", "body": "正文"}, 201))
	if inherited.Creative.Angle != "原角度" {
		t.Fatal("legacy edit lost settings")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "标题", "body": "正文", "creative": domain.CreativeSettings{VideoHook: "unknown"}}, 400)
}

func TestCreativeSelectedAssetProvenanceIsFrozenAndSafe(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "图片记录"}, 201))
	image := sampleImage(t, a)
	j := newJob("image_generation", p.ID, map[string]any{"model": "image-test", "creative": domain.CreativeSettings{Angle: "原图片角度", ImageHook: "detail"}, "scenes": []string{"原画面描述"}, "secret": "must-not-leak", "provider_url": "must-not-leak"})
	j.Result = image.ID
	j.State = "succeeded"
	if err := store.Put(a.Store.DB, "jobs", j.ID, j); err != nil {
		t.Fatal(err)
	}
	media := domain.VersionMedia{Kind: "image", AssetIDs: []string{image.ID}, CoverID: image.ID}
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "新文案", "body": "正文", "creative": domain.CreativeSettings{Angle: "新的版本角度"}, "media": media}, 201))
	if len(v.GenerationRecords) != 1 || v.GenerationRecords[0].AssetID != image.ID {
		t.Fatal("duplicate cover record or missing selection provenance")
	}
	raw := jsonString(v)
	if strings.Contains(raw, "must-not-leak") || !strings.Contains(raw, "原图片角度") || !strings.Contains(raw, "新的版本角度") {
		t.Fatal("wrong creative provenance or leaked private data")
	}
	j.Payload["scenes"] = []string{"任务后来变化"}
	_ = store.Put(a.Store.DB, "jobs", j.ID, j)
	frozen, _ := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	if !strings.Contains(jsonString(frozen.GenerationRecords), "原画面描述") || strings.Contains(jsonString(frozen.GenerationRecords), "任务后来变化") {
		t.Fatal("snapshot follows mutable task")
	}
}

func TestAngleUnstructuredResponseRemainsUsableWithoutAnotherCall(t *testing.T) {
	a := testApp(t)
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "测试", "model": "fixture", "base_url": "https://example.com/v1", "secret": "fixture-key"}, 200))
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "话题"}, 201))
	q := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/suggest-angles", map[string]any{"model_id": m.ID, "copy_text": "参考帖子在聊桌面整理"}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", q["job_id"])
	response := "可以买了收纳盒还是乱聊起；也可以聊最常找不到的那件小东西；还可以讨论桌面留多少空白才舒服。"
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": response}, "finish_reason": "stop"}}})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(body)))}, nil
	})
	if _, err := a.runAngleSuggestions(j); err != nil {
		t.Fatal(err)
	}
	if _, err := a.runAngleSuggestions(j); err != nil {
		t.Fatal(err)
	}
	saved, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if asString(saved.Payload["angle_text"]) != response || calls != 1 {
		t.Fatal("free prose was lost or reformatted with another paid call")
	}
	versions, _ := store.List[domain.Version](a.Store.DB, "versions")
	if len(versions) != 0 {
		t.Fatal("suggestion became a post without selection")
	}
}
