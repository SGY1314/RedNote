package app

import (
	"bytes"
	"encoding/json"
	"mime"
	"net/http/httptest"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestFriendlyAssetNamesPreserveStoredMetadataAndDownloads(t *testing.T) {
	a := testApp(t)
	p := domain.Project{ID: ID(), Name: "周末手记"}
	if err := store.Put(a.Store.DB, "projects", p.ID, p); err != nil {
		t.Fatal(err)
	}
	first := sampleImage(t, a)
	first.Name, first.OriginalName = "ScreenShot_2026-11-03_200440_153.png", "ScreenShot_2026-11-03_200440_153.png"
	first.ProjectID, first.CreatedAt = p.ID, "2026-11-01T01:00:00Z"
	second := first
	second.ID = ID()
	second.Name = "7704244765763603752-01"
	second.OriginalName = ""
	second.CreatedAt = "2026-11-02T01:00:00Z"
	for _, v := range []domain.Asset{first, second} {
		if err := store.Put(a.Store.DB, "assets", v.ID, v); err != nil {
			t.Fatal(err)
		}
	}
	names, err := assetPresentations(a.Store.DB)
	if err != nil {
		t.Fatal(err)
	}
	if names[first.ID].Name != "周末手记－图片01" || names[second.ID].Name != "周末手记－图片02" || names[first.ID].OriginalName != first.Name {
		t.Fatal("unfriendly or unstable display names", names)
	}
	persisted, _ := store.Get[domain.Asset](a.Store.DB, "assets", first.ID)
	if persisted.Name != first.Name || persisted.Path != first.Path || persisted.SHA256 != first.SHA256 {
		t.Fatal("presentation modified stored metadata")
	}
	req := httptest.NewRequest("GET", "http://127.0.0.1:8080/api/v1/assets/"+first.ID+"/file?download=1", nil)
	response := httptest.NewRecorder()
	a.Router().ServeHTTP(response, req)
	_, params, err := mime.ParseMediaType(response.Header().Get("Content-Disposition"))
	if err != nil || params["filename"] != "周末手记－图片01.png" {
		t.Fatal("download and display names differ", params)
	}
	list := decode[[]domain.Asset](t, request(t, a, "GET", "/assets", nil, 200))
	found := false
	for _, v := range list {
		if v.ID == first.ID {
			found = v.Name == names[first.ID].Name
		}
	}
	if !found {
		t.Fatal("list did not present friendly name")
	}
	syncBody := request(t, a, "GET", "/sync", nil, 200)
	var batch struct {
		Changes []syncChange `json:"changes"`
	}
	if err := json.Unmarshal(syncBody, &batch); err != nil {
		t.Fatal(err)
	}
	found = false
	for _, change := range batch.Changes {
		if change.Entity == "assets" && change.ID == first.ID {
			var v domain.Asset
			json.Unmarshal(change.Value, &v)
			found = v.Name == names[first.ID].Name
		}
	}
	if !found {
		t.Fatal("sync overwrote friendly name")
	}
	first.DeletedAt = Now()
	store.Put(a.Store.DB, "assets", first.ID, first)
	names, _ = assetPresentations(a.Store.DB)
	if names[second.ID].Name != "周末手记－图片02" {
		t.Fatal("removal renumbered other media")
	}
	custom := decode[domain.Asset](t, request(t, a, "PATCH", "/assets/"+second.ID, map[string]string{"name": "1234567890123456"}, 200))
	if custom.Name != "1234567890123456" || !custom.NameCustomized {
		t.Fatal("numeric custom name was rewritten")
	}
}

func TestFriendlyAssetNameDetection(t *testing.T) {
	for _, name := range []string{"7704244765763603752-01", "6142f15f0123456789abcdef01234567.png", "ScreenShot_2026-11-03_200440_153.png", "微信图片_20261112121212.jpg", "生成图片", "AI 视频镜头", "视频 · 10秒"} {
		if !automaticAsset(domain.Asset{Name: name}) {
			t.Fatal("default name not recognized", name)
		}
	}
	for _, v := range []domain.Asset{{Name: "海边日落.png"}, {Name: "图片123", NameCustomized: true}, {Name: "7704244765763603752", OriginalName: "旧名称"}} {
		if automaticAsset(v) {
			t.Fatal("custom name would be replaced", v.Name)
		}
	}
}

func TestResultRemovalPersistsWithoutDeletingAssetsOrConfirmedMedia(t *testing.T) {
	for _, kind := range []string{"image", "video"} {
		t.Run(kind, func(t *testing.T) {
			a, p, _ := stageSourceFixture(t)
			v := sampleImage(t, a)
			if kind == "video" {
				v = nativeVideoFixture(t, a, p)
			}
			v.ProjectID, v.Source = p.ID, "upload"
			store.Put(a.Store.DB, "assets", v.ID, v)
			w, _ := a.readWorkflow(p.ID)
			basis, _ := a.readWorkflowBasis(p, w)
			media := domain.VersionMedia{Kind: kind, AssetIDs: []string{v.ID}}
			reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", map[string]any{"step": kind, "title_key": basis.Title.Key, "copy_key": basis.Copy.Key, "media": media, "use_project_image_results": kind == "image", "use_project_video_results": kind == "video"}, 201))
			before := request(t, a, "GET", "/assets/"+v.ID+"/file", nil, 200)
			w, _ = a.readWorkflow(p.ID)
			raw := map[string]any{"excluded_result_asset_ids": []string{v.ID}, "selected_asset_ids": []string{}, "upload_slots": []string{""}, "result_asset_ids": []string{}}
			request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/drafts/"+kind, map[string]any{"revision": w.Drafts[kind].Revision, "data": raw}, 200)
			if err := a.validateProjectMediaResults(p, &media, kind); err == nil {
				t.Fatal("removed result could be confirmed again")
			}
			if !bytes.Equal(before, request(t, a, "GET", "/assets/"+v.ID+"/file", nil, 200)) {
				t.Fatal("removal deleted original bytes")
			}
			stored, _ := store.Get[domain.Asset](a.Store.DB, "assets", v.ID)
			if stored.DeletedAt != "" {
				t.Fatal("source asset moved to trash")
			}
			confirmed, _ := store.Get[domain.Version](a.Store.DB, "versions", reply.Version.ID)
			if len(confirmed.Media.AssetIDs) != 1 || confirmed.Media.AssetIDs[0] != v.ID {
				t.Fatal("old confirmed media changed")
			}
			other := p
			other.ID = ID()
			if err := store.Put(a.Store.DB, "projects", other.ID, other); err != nil {
				t.Fatal(err)
			}
			v.ProjectID = ""
			v.LibraryState = "saved"
			store.Put(a.Store.DB, "assets", v.ID, v)
			otherWorkflow, _ := a.readWorkflow(other.ID)
			data, _ := json.Marshal(map[string]any{"result_asset_ids": []string{v.ID}})
			otherWorkflow.Drafts[kind] = workflowDraft{Data: data}
			store.Put(a.Store.DB, "creation_workflows", other.ID, otherWorkflow)
			if err := a.validateProjectMediaResults(other, &media, kind); err != nil {
				t.Fatal("removal affected another project", err)
			}
		})
	}
}
