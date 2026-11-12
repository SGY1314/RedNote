package app

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"slices"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestWorkflowImageUploadAndEditedSourceCopy(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	sample := sampleImage(t, a)
	imageBytes := request(t, a, "GET", "/assets/"+sample.ID+"/file", nil, 200)
	upload := func(project string, status int) []byte {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, _ := writer.CreateFormFile("file", "我的创作.png")
		part.Write(imageBytes)
		writer.WriteField("project_id", project)
		writer.Close()
		req := httptest.NewRequest("POST", "http://127.0.0.1:8080/api/v1/assets", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("X-CSRF-Token", a.CSRF)
		recorder := httptest.NewRecorder()
		a.Router().ServeHTTP(recorder, req)
		if recorder.Code != status {
			t.Fatal(recorder.Code, recorder.Body.String())
		}
		return recorder.Body.Bytes()
	}
	asset := decode[domain.Asset](t, upload(p.ID, 201))
	if asset.ProjectID != p.ID || asset.Source != "upload" || asset.Kind != "image" {
		t.Fatal("upload lost project ownership", asset)
	}
	base := "/rewrites/" + p.ID + "/workflow"
	copyResult := decode[stageReply](t, request(t, a, "POST", base+"/stage", map[string]any{"step": "copy", "text": "编辑后的原始文案", "topics": []string{"新话题"}}, 201))
	if copyResult.Version.Body != "编辑后的原始文案" || !slices.Equal(copyResult.Version.Topics, []string{"新话题"}) {
		t.Fatal("edited original copy was not saved")
	}
	original, _ := store.Get[domain.Revision](a.Store.DB, "revisions", source.ID)
	if original.Body != source.Body || !slices.Equal(original.Topics, source.Topics) {
		t.Fatal("editing a project changed its collected source")
	}
	result := decode[stageReply](t, request(t, a, "POST", base+"/stage", map[string]any{
		"step": "image", "use_project_image_results": true,
		"title_key": copyResult.Workflow.Title.Key, "copy_key": copyResult.Workflow.Copy.Key,
		"media":   domain.VersionMedia{Kind: "image", AssetIDs: []string{asset.ID}, CoverID: asset.ID},
		"publish": true,
	}, 201))
	if !slices.Equal(result.Version.Media.AssetIDs, []string{asset.ID}) || result.Version.Body != "编辑后的原始文案" || result.Publications[0].Ready {
		t.Fatal("uploaded image was not saved into the pending publication")
	}
	other := p
	other.ID = ID()
	store.Put(a.Store.DB, "projects", other.ID, other)
	if err := a.validateProjectImageResults(other, &domain.VersionMedia{Kind: "image", AssetIDs: []string{asset.ID}}); err == nil {
		t.Fatal("another project could use the upload")
	}
	upload("missing-project", 404)
	p.DeletedAt = Now()
	store.Put(a.Store.DB, "projects", p.ID, p)
	upload(p.ID, 409)
}
