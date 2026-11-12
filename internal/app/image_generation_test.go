package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func imageJobFixture(t *testing.T, a *App) (domain.Project, rewriteModel, domain.Job) {
	t.Helper()
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "图片生成测试"}, 201))
	m := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]string{"name": "配图模型", "model": "image-fixture", "base_url": "https://example.com/v1", "secret": "image-key"}, 200))
	job := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]string{"model_id": m.ID, "prompt": "暖色书桌", "size": "1024x1024"}, 202))
	j, err := store.Get[domain.Job](a.Store.DB, "jobs", job["job_id"])
	if err != nil {
		t.Fatal(err)
	}
	return p, m, j
}

func TestImageGenerationLocalResultOrderingAndSnapshot(t *testing.T) {
	a := testApp(t)
	p, m, j := imageJobFixture(t, a)
	if len(decode[[]rewriteModel](t, request(t, a, "GET", "/rewrite-models", nil, 200))) != 1 {
		t.Fatal("image configuration changed text profiles")
	}
	public := string(request(t, a, "GET", "/image-models", nil, 200)) + string(request(t, a, "GET", "/jobs", nil, 200))
	if strings.Contains(public, "image-key") {
		t.Fatal("secret exposed")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]string{"model_id": m.ID, "prompt": "second"}, 409)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 409)
	request(t, a, "PUT", "/image-models/"+m.ID, map[string]string{"name": "已改配置", "model": "changed", "base_url": "https://changed.example/v1", "secret": "changed-key"}, 200)
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewRGBA(image.Rect(0, 0, 16, 24))); err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(pngBytes.Bytes())}}})
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.String() != "https://example.com/v1/images/generations" || r.Header.Get("Authorization") != "Bearer image-key" || body["model"] != "image-fixture" || body["n"] != float64(1) || body["prompt"] != "暖色书桌" || body["size"] != "1024x1024" {
			t.Fatal("wrong frozen model, credential, or image request")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(out)), Header: make(http.Header)}, nil
	})
	id, err := a.execute(j)
	if err != nil {
		t.Fatal(err)
	}
	v, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
	if err != nil || v.ProjectID != p.ID || v.ProjectName != p.Name || v.Source != "generated" || v.LibraryState != "result" || v.Width != 16 || v.Height != 24 || v.Status != "ready" {
		t.Fatalf("invalid local image: %+v / %v", v, err)
	}
	f, err := a.openMedia(v.Path)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(f)
	f.Close()
	if err != nil || !bytes.Equal(b, pngBytes.Bytes()) {
		t.Fatal("image not saved locally")
	}
	if again, e := a.execute(j); e != nil || again != id || calls != 1 {
		t.Fatal("retry charged for existing local result")
	}
	upload := sampleImage(t, a)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{upload.ID, id}}, 200)
	version := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"title": "图文", "body": "配图内容"}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+version.ID+"/confirm", nil, 200)
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]any{"version_id": version.ID, "kind": "image", "asset_ids": []string{upload.ID, id}}, 201))
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{id, upload.ID}}, 200)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]string{"kind": "video"}, 200)
	restored := decode[domain.Project](t, request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]string{"kind": "image"}, 200))
	if !reflect.DeepEqual(restored.AssetIDs, []string{id, upload.ID}) {
		t.Fatal("generated and uploaded image order lost")
	}
	snapshot, _ := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if !reflect.DeepEqual(snapshot.AssetIDs, []string{upload.ID, id}) {
		t.Fatal("reordering mutated existing publication snapshot")
	}
	j.State = "succeeded"
	j.Result = id
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 200)
	if _, err = store.Get[domain.Service](a.Store.DB, "settings", "image-job-"+j.ID); err == nil {
		t.Fatal("purge retained credential snapshot")
	}
	if _, err = store.Get[domain.Asset](a.Store.DB, "assets", id); err != nil {
		t.Fatal("project purge removed reusable image")
	}
}

func TestImageGenerationRejectsMissingConfigAndFalseResults(t *testing.T) {
	a := testApp(t)
	if len(decode[[]rewriteModel](t, request(t, a, "GET", "/image-models", nil, 200))) != 0 {
		t.Fatal("unexpected default image configuration")
	}
	p, m, j := imageJobFixture(t, a)
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]string{"model_id": m.ID, "prompt": " "}, 400)
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]string{"model_id": m.ID, "prompt": "test", "size": "bad"}, 400)
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]string{"model_id": "missing", "prompt": "test"}, 400)
	request(t, a, "PUT", "/image-models/"+m.ID, map[string]any{"name": m.Name, "model": m.Model, "base_url": m.BaseURL, "clear_secret": true}, 200)
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", map[string]string{"model_id": m.ID, "prompt": "test"}, 400)
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	for _, fixture := range []struct {
		code int
		body string
	}{{403, `{"error":"image-key"}`}, {200, `{"data":[]}`}, {200, `{"data":[{"b64_json":"bm90LWFuLWltYWdl"}]}`}, {200, `{"data":[{"url":"https://127.0.0.1/private"}]}`}} {
		http.DefaultTransport = rewriteTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: fixture.code, Body: io.NopCloser(strings.NewReader(fixture.body)), Header: make(http.Header)}, nil
		})
		if id, err := a.execute(j); err == nil || id != "" || strings.Contains(err.Error(), "image-key") {
			t.Fatal("failed image request reported success or leaked response", id, err)
		}
		assets, _ := store.List[domain.Asset](a.Store.DB, "assets")
		if len(assets) != 0 {
			t.Fatal("failure created fake asset")
		}
	}
}

func TestGeneratedImageURLBoundary(t *testing.T) {
	for _, raw := range []string{"http://example.com/a.png", "https://example.com.evil.test/a.png", "https://example.com:8443/a.png", "https://user:pass@example.com/a.png", "https://127.0.0.1/a.png"} {
		if generatedImageURL(raw, "https://example.com/v1") == nil {
			t.Fatal("unsafe image URL accepted", raw)
		}
	}
	for _, raw := range []string{"https://example.com/image.png", "https://fixture.blob.core.windows.net/image.png", "https://image.aliyuncs.com/image.png"} {
		if err := generatedImageURL(raw, "https://example.com/v1"); err != nil {
			t.Fatal(err)
		}
	}
}
