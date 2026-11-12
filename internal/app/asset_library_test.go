package app

import (
	"bytes"
	"reflect"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestGeneratedLibrarySaveIndependentFromPublicationSelection(t *testing.T) {
	a := testApp(t)
	asset, legacy := sampleImage(t, a), sampleImage(t, a)
	asset.Source, asset.LibraryState = "generated", "result"
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	library := decode[[]domain.Asset](t, request(t, a, "GET", "/assets", nil, 200))
	if len(library) != 1 || library[0].ID != legacy.ID {
		t.Fatal("result leaked into library or legacy asset hidden")
	}
	results := decode[[]domain.Asset](t, request(t, a, "GET", "/assets?include_results=true", nil, 200))
	if len(results) != 2 {
		t.Fatal("result unavailable for preview")
	}
	before := request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "显式选择测试"}, 201))
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{asset.ID}, "cover_id": asset.ID}, 200)
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"title": "完整版本", "body": "保留完整素材快照"}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", nil, 200)
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]any{"version_id": v.ID, "kind": "image", "asset_ids": []string{asset.ID}, "cover_id": asset.ID}, 201))
	v, _ = store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{}, "cover_id": ""}, 200)
	current, _ := store.Get[domain.Asset](a.Store.DB, "assets", asset.ID)
	if current.LibraryState != "result" {
		t.Fatal("selection or removal auto-saved result into library")
	}
	first := request(t, a, "POST", "/assets/"+asset.ID+"/save-to-library", nil, 200)
	second := request(t, a, "POST", "/assets/"+asset.ID+"/save-to-library", nil, 200)
	if !bytes.Equal(first, second) {
		t.Fatal("repeated save is not idempotent")
	}
	saved := decode[domain.Asset](t, first)
	if saved.LibraryState != "saved" || saved.Path != asset.Path || saved.SHA256 != asset.SHA256 {
		t.Fatal("save duplicated or changed media identity")
	}
	if !bytes.Equal(before, request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)) {
		t.Fatal("file changed")
	}
	reopened, err := store.Open(a.Config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	saved, _ = store.Get[domain.Asset](reopened.DB, "assets", asset.ID)
	if saved.LibraryState != "saved" {
		t.Fatal("library choice not durable")
	}
	currentProject, _ := store.Get[domain.Project](reopened.DB, "projects", p.ID)
	if len(currentProject.AssetIDs) != 0 {
		t.Fatal("library save reselected publication media")
	}
	storedVersion, _ := store.Get[domain.Version](reopened.DB, "versions", v.ID)
	storedPub, _ := store.Get[domain.Publication](reopened.DB, "publications", pub.ID)
	if !reflect.DeepEqual(storedVersion, v) {
		t.Fatal("version replaced")
	}
	if !reflect.DeepEqual(storedPub, pub) {
		t.Fatal("published snapshot changed")
	}
	if len(decode[[]domain.Asset](t, request(t, a, "GET", "/assets", nil, 200))) != 2 {
		t.Fatal("library save missing or duplicated")
	}
}

func TestLibrarySaveRejectsUnavailableResults(t *testing.T) {
	for _, scenario := range []string{"deleted", "pending", "missing", "outside", "empty"} {
		t.Run(scenario, func(t *testing.T) {
			a := testApp(t)
			v := sampleImage(t, a)
			v.LibraryState = "result"
			switch scenario {
			case "deleted":
				v.DeletedAt = Now()
			case "pending":
				v.Status = "pending"
			case "missing":
				v.Path = "missing.png"
			case "outside":
				v.Path = "../outside.png"
			case "empty":
				v.Path = ""
			}
			store.Put(a.Store.DB, "assets", v.ID, v)
			request(t, a, "POST", "/assets/"+v.ID+"/save-to-library", nil, 409)
			got, _ := store.Get[domain.Asset](a.Store.DB, "assets", v.ID)
			if got.LibraryState != "result" {
				t.Fatal("unavailable result saved")
			}
		})
	}
}
