package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type rewriteTransport func(*http.Request) (*http.Response, error)

func TestRewriteModelLegacyAndValidation(t *testing.T) {
	a := testApp(t)
	sealed, err := adapter.Seal("legacy-fixture-key")
	if err != nil {
		t.Fatal(err)
	}
	s := a.settings()
	s.Text.Secret = sealed
	if err = store.Put(a.Store.DB, "settings", "services", s); err != nil {
		t.Fatal(err)
	}
	response := request(t, a, "GET", "/rewrite-models", nil, 200)
	models := decode[[]rewriteModel](t, response)
	if !models[0].Configured || models[0].Secret != "" || strings.Contains(string(response), sealed) {
		t.Fatal("legacy key was not masked")
	}
	request(t, a, "PUT", "/rewrite-models/default", map[string]string{"name": "旧模型新名称", "model": "legacy-updated", "base_url": s.Text.BaseURL}, 200)
	saved, err := a.rewriteModels()
	if err != nil || saved[0].Secret != sealed {
		t.Fatal("blank key did not preserve stored credential")
	}
	request(t, a, "POST", "/rewrite-models", map[string]string{"name": "invalid", "model": "m", "base_url": "https://example.com/?secret=test"}, 400)
	request(t, a, "PUT", "/rewrite-models/missing", map[string]string{"name": "missing", "model": "m", "base_url": s.Text.BaseURL}, 404)
	request(t, a, "PUT", "/settings", map[string]any{"ocr": s.OCR, "asr": s.ASR}, 200)
	if a.settings().Text.Secret != sealed {
		t.Fatal("saving OCR settings cleared legacy text credential")
	}
}

func (f rewriteTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRewriteModelsSeparateVersionsAndFrozenConfig(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "模型对比"}, 201))
	legacy := decode[[]rewriteModel](t, request(t, a, "GET", "/rewrite-models", nil, 200))
	if len(legacy) != 1 || legacy[0].ID != "default" || legacy[0].Configured {
		t.Fatal("legacy configuration missing")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]string{"requirements": "测试", "model_id": "default"}, 400)
	create := func(name, model, key string) rewriteModel {
		b := request(t, a, "POST", "/rewrite-models", map[string]string{"name": name, "base_url": "https://example.com/v1", "model": model, "secret": key}, 200)
		if strings.Contains(string(b), key) {
			t.Fatal("credential exposed")
		}
		return decode[rewriteModel](t, b)
	}
	first := create("模型 A", "model-a", "key-a")
	second := create("模型 B", "model-b", "key-b")
	list := request(t, a, "GET", "/rewrite-models", nil, 200)
	if strings.Contains(string(list), "key-a") || strings.Contains(string(list), "key-b") {
		t.Fatal("model list exposed credentials")
	}
	submit := func(id string) domain.Job {
		r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]string{"requirements": "给相同主题写一篇短文", "model_id": id}, 202))
		j, e := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
		if e != nil {
			t.Fatal(e)
		}
		if strings.Contains(jsonString(j), "key-") || strings.Contains(jsonString(j), "secret") {
			t.Fatal("job exposed credentials")
		}
		return j
	}
	picture := sampleImage(t, a)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{picture.ID}}, 200)
	j1 := submit(first.ID)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{}}, 200)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{picture.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{picture.ID}, "confirm": true}, 409)
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]string{"requirements": "测试", "model_id": second.ID}, 409)
	request(t, a, "PUT", "/rewrite-models/"+first.ID, map[string]string{"name": "已改配置", "model": "changed", "base_url": "https://changed.example/v1", "secret": "new-key"}, 200)
	frozen, err := a.rewriteJobService(j1)
	if err != nil {
		t.Fatal(err)
	}
	key, err := adapter.Unseal(frozen.Secret)
	if err != nil || key != "key-a" || frozen.Model != "model-a" {
		t.Fatal("queued service changed")
	}
	oldTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		var b struct {
			Model string `json:"model"`
		}
		json.NewDecoder(r.Body).Decode(&b)
		expected := []string{"model-a", "model-b"}[calls]
		if b.Model != expected || r.URL.Host != "example.com" {
			t.Error("wrong model or endpoint")
		}
		if r.Header.Get("Authorization") != "Bearer "+[]string{"key-a", "key-b"}[calls] {
			t.Error("wrong model credential")
		}
		calls++
		content := `{"title":"` + expected + `","body":"独立正文","topics":["测试"]}`
		out, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}, "finish_reason": "stop"}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(out))), Header: make(http.Header)}, nil
	})
	id1, err := a.runRewrite(j1)
	if err != nil {
		t.Fatal(err)
	}
	j1.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j1.ID, j1)
	j2 := submit(second.ID)
	id2, err := a.runRewrite(j2)
	if err != nil {
		t.Fatal(err)
	}
	v1, _ := store.Get[domain.Version](a.Store.DB, "versions", id1)
	v2, _ := store.Get[domain.Version](a.Store.DB, "versions", id2)
	if v1.Media == nil || len(v1.Media.AssetIDs) != 1 || v1.Media.AssetIDs[0] != picture.ID || v2.Media == nil || len(v2.Media.AssetIDs) != 0 {
		t.Fatal("generated version did not freeze media at submission")
	}
	if v1.Number != 0 || v2.Number != 0 || !v1.Generated || !v2.Generated || v1.ModelName != "模型 A" || v1.Model != "model-a" || v2.Model != "model-b" || v1.ID == v2.ID {
		t.Fatal("independent versions or provenance lost")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+id1+"/confirm", nil, 409)
	v2, _ = store.Get[domain.Version](a.Store.DB, "versions", id2)
	if v2.Status != "draft" {
		t.Fatal("confirmation changed other version")
	}
	edited := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "人工修改", "body": "人工正文", "parent_id": id1}, 201))
	if edited.ParentID != id1 || edited.Model != "model-a" || edited.Number != 1 || edited.Generated {
		t.Fatal("manual edit provenance incorrect")
	}
	request(t, a, "PUT", "/rewrite-models/"+second.ID, map[string]any{"name": second.Name, "model": second.Model, "base_url": second.BaseURL, "clear_secret": true}, 200)
	j2.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j2.ID, j2)
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]string{"requirements": "测试", "model_id": second.ID}, 400)
	if calls != 2 {
		t.Fatal("unexpected paid requests")
	}
}
