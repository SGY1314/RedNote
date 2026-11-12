package app

import (
	"bytes"
	"mime"
	"mime/multipart"
	"net/http/httptest"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestAssetRenameCategoryPreserveBytesAndReferences(t *testing.T) {
	a := testApp(t)
	asset := sampleImage(t, a)
	project := domain.Project{ID: ID(), Kind: "image", AssetIDs: []string{asset.ID}, CoverID: asset.ID}
	publication := domain.Publication{ID: ID(), AssetIDs: []string{asset.ID}, CoverID: asset.ID}
	store.Put(a.Store.DB, "projects", project.ID, project)
	store.Put(a.Store.DB, "publications", publication.ID, publication)
	before := request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)
	renamed := decode[domain.Asset](t, request(t, a, "PATCH", "/assets/"+asset.ID, map[string]string{"name": "海边日落", "category": "旅行"}, 200))
	if renamed.OriginalName != asset.Name || renamed.Name != "海边日落" || renamed.Category != "旅行" || renamed.Path != asset.Path || renamed.SHA256 != asset.SHA256 {
		t.Fatal("rename changed file identity or lost original name")
	}
	if !bytes.Equal(before, request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)) {
		t.Fatal("file content changed")
	}
	p, _ := store.Get[domain.Project](a.Store.DB, "projects", project.ID)
	pub, _ := store.Get[domain.Publication](a.Store.DB, "publications", publication.ID)
	if p.AssetIDs[0] != asset.ID || pub.CoverID != asset.ID {
		t.Fatal("existing references changed")
	}
	req := httptest.NewRequest("GET", "http://127.0.0.1:8080/api/v1/assets/"+asset.ID+"/file?download=1", nil)
	w := httptest.NewRecorder()
	a.Router().ServeHTTP(w, req)
	_, params, err := mime.ParseMediaType(w.Header().Get("Content-Disposition"))
	if err != nil || params["filename"] != "海边日落.png" {
		t.Fatalf("download filename mismatch: %v %v", params, err)
	}
	request(t, a, "PATCH", "/assets/"+asset.ID, map[string]string{"name": "../不能成为路径"}, 400)
	request(t, a, "PATCH", "/assets/"+asset.ID, map[string]string{"name": ""}, 400)
	final, _ := store.Get[domain.Asset](a.Store.DB, "assets", asset.ID)
	if final.Name != renamed.Name {
		t.Fatal("invalid rename persisted")
	}
}

func TestBatchCategoryAtomicAndClearable(t *testing.T) {
	a := testApp(t)
	first, second := sampleImage(t, a), sampleImage(t, a)
	request(t, a, "PATCH", "/assets/category", map[string]any{"ids": []string{first.ID, "missing"}, "category": "旅行"}, 404)
	check, _ := store.Get[domain.Asset](a.Store.DB, "assets", first.ID)
	if check.Category != "" {
		t.Fatal("batch partially updated")
	}
	request(t, a, "PATCH", "/assets/category", map[string]any{"ids": []string{first.ID, second.ID, first.ID}, "category": "  旅行  "}, 200)
	for _, id := range []string{first.ID, second.ID} {
		check, _ := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if check.Category != "旅行" {
			t.Fatal("category not saved")
		}
	}
	request(t, a, "PATCH", "/assets/category", map[string]any{"ids": []string{first.ID, second.ID}, "category": ""}, 200)
	check, _ = store.Get[domain.Asset](a.Store.DB, "assets", first.ID)
	if check.Category != "" {
		t.Fatal("category not cleared")
	}
}

func TestOwnUploadWithCategory(t *testing.T) {
	a := testApp(t)
	sample := sampleImage(t, a)
	fileBytes := request(t, a, "GET", "/assets/"+sample.ID+"/file", nil, 200)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "我的照片.png")
	part.Write(fileBytes)
	writer.WriteField("category", "个人素材")
	writer.Close()
	req := httptest.NewRequest("POST", "http://127.0.0.1:8080/api/v1/assets", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-CSRF-Token", a.CSRF)
	w := httptest.NewRecorder()
	a.Router().ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	asset := decode[domain.Asset](t, w.Body.Bytes())
	if asset.Name != "我的照片.png" || asset.OriginalName != asset.Name || asset.Category != "个人素材" || asset.Source != "upload" || asset.Status != "ready" {
		t.Fatalf("bad upload metadata: %+v", asset)
	}
}
