package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestImageReferencesAndCopyReachModel(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "参考图测试"}, 201))
	first, second := sampleImage(t, a), sampleImage(t, a)
	firstBytes, _ := os.ReadFile(filepath.Join(a.Config.DataDir, "media", first.Path))
	secondBytes, _ := os.ReadFile(filepath.Join(a.Config.DataDir, "media", second.Path))
	// Give the second input distinct valid bytes (different PNG ancillary trailer).
	secondBytes = append(secondBytes, []byte("second")...)
	os.WriteFile(filepath.Join(a.Config.DataDir, "media", second.Path), secondBytes, 0600)
	m := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]string{"name": "Qwen", "model": "Qwen-Image-3.0", "base_url": "https://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "secret": "reference-key"}, 200))
	models := decode[[]rewriteModel](t, request(t, a, "GET", "/image-models", nil, 200))
	if models[0].ReferenceLimit != 3 || models[0].Model != "qwen-image-3.0" {
		t.Fatal("official capability not recognized", models)
	}
	inputs := map[string]any{"model_id": m.ID, "prompt": "参考图 1 的构图，暖色调", "copy_text": "未保存的标题\n我刚写的新文案 #生活", "reference_asset_ids": []string{second.ID, first.ID}}
	result := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate-image", inputs, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	request(t, a, "PUT", "/image-models/"+m.ID, map[string]string{"name": "new", "model": "other", "base_url": "https://example.com/v1", "secret": "new-key", "reference_mode": "none"}, 200)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{first.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{first.ID}, "confirm": true}, 409)
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var body struct {
			Model  string   `json:"model"`
			Prompt string   `json:"prompt"`
			Images []string `json:"image"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "qwen-image-3.0" || r.Header.Get("Authorization") != "Bearer reference-key" || !strings.Contains(r.URL.Host, "maas.aliyuncs.com") {
			t.Fatal("lost frozen config")
		}
		if !strings.Contains(body.Prompt, "未保存的标题\n我刚写的新文案 #生活") || !strings.Contains(body.Prompt, "参考图 1 的构图，暖色调") {
			t.Fatal("copy or instructions missing", body.Prompt)
		}
		if len(body.Images) != 2 {
			t.Fatal("references missing")
		}
		for i, want := range [][]byte{secondBytes, firstBytes} {
			got, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(body.Images[i], "data:image/png;base64,"))
			if e != nil || !bytes.Equal(got, want) {
				t.Fatal("reference bytes/order wrong", i)
			}
		}
		out, _ := json.Marshal(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(firstBytes)}}})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(out))}, nil
	})
	if _, e := a.execute(j); e != nil {
		t.Fatal(e)
	}
	if calls != 1 {
		t.Fatal("unexpected calls", calls)
	}
}

func TestImageReferencesValidationBeforePaidCall(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "validation"}, 201))
	m := decode[rewriteModel](t, request(t, a, "POST", "/image-models", map[string]string{"name": "model", "model": "custom", "base_url": "https://example.com/v1", "secret": "key"}, 200))
	v := sampleImage(t, a)
	endpoint := "/rewrites/" + p.ID + "/generate-image"
	request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "reference_asset_ids": []string{v.ID}}, 400)
	request(t, a, "PUT", "/image-models/"+m.ID, map[string]string{"name": "model", "model": "custom", "base_url": "https://example.com/v1", "reference_mode": "generations_image"}, 200)
	for _, ids := range [][]string{{v.ID, v.ID}, {"missing"}, {v.ID, "2", "3", "4"}} {
		request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "reference_asset_ids": ids}, 400)
	}
	request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "copy_text": strings.Repeat("字", 12001)}, 400)
	result := decode[map[string]string](t, request(t, a, "POST", endpoint, map[string]any{"model_id": m.ID, "reference_asset_ids": []string{v.ID}}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	f, e := os.OpenFile(filepath.Join(a.Config.DataDir, "media", v.Path), os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	f.WriteString("changed")
	f.Close()
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	http.DefaultTransport = rewriteTransport(func(*http.Request) (*http.Response, error) { t.Fatal("paid call before validation"); return nil, nil })
	if _, e := a.execute(j); e == nil || !strings.Contains(e.Error(), "内容已改变") {
		t.Fatal("changed reference accepted", e)
	}
}

func TestRewriteReferenceImagesFollowOriginalSnapshot(t *testing.T) {
	a := testApp(t)
	first, second := sampleImage(t, a), sampleImage(t, a)
	old := domain.Revision{ID: ID(), NoteID: "note", AssetIDs: []string{second.ID, first.ID}}
	store.Put(a.Store.DB, "revisions", old.ID, old)
	next := domain.Revision{ID: ID(), NoteID: "note", AssetIDs: []string{first.ID}}
	store.Put(a.Store.DB, "revisions", next.ID, next)
	store.Put(a.Store.DB, "notes", "note", domain.Note{ID: "note", RevisionID: next.ID})
	p := domain.Project{ID: ID(), RevisionID: old.ID, NoteID: "note"}
	store.Put(a.Store.DB, "projects", p.ID, p)
	var d struct {
		Images []domain.Asset `json:"reference_assets"`
	}
	json.Unmarshal(request(t, a, "GET", "/rewrites/"+p.ID, nil, 200), &d)
	if len(d.Images) != 2 || d.Images[0].ID != second.ID || d.Images[1].ID != first.ID {
		t.Fatal("recollection changed reference images", d)
	}
}
