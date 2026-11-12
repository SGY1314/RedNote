package app

import (
	"reflect"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestMediaFormatsRetainSelectionsCoversAndOrder(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "素材切换回归"}, 201))
	first, second := sampleImage(t, a), sampleImage(t, a)
	clip := domain.Asset{ID: ID(), Kind: "video", Status: "ready", Name: "已上传视频.mp4"}
	if err := store.Put(a.Store.DB, "assets", clip.ID, clip); err != nil {
		t.Fatal(err)
	}
	update := func(body map[string]any) domain.Project {
		return decode[domain.Project](t, request(t, a, "PATCH", "/rewrites/"+p.ID, body, 200))
	}
	update(map[string]any{"kind": "image", "asset_ids": []string{second.ID, first.ID}, "cover_id": second.ID})
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "保留的文稿", "body": "文稿不随素材类型切换而改变"}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", map[string]any{}, 200)
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]any{"version_id": v.ID, "kind": "image", "asset_ids": []string{second.ID, first.ID}, "cover_id": second.ID}, 201))
	got := update(map[string]any{"kind": "video"})
	if len(got.AssetIDs) != 0 || got.CoverID != "" {
		t.Fatal("new video draft must start empty")
	}
	update(map[string]any{"kind": "video", "asset_ids": []string{clip.ID}, "cover_id": first.ID})
	got = update(map[string]any{"kind": "image"})
	if !reflect.DeepEqual(got.AssetIDs, []string{second.ID, first.ID}) || got.CoverID != second.ID {
		t.Fatal("image order/cover lost on switch")
	}
	update(map[string]any{"kind": "image", "asset_ids": []string{first.ID, second.ID}, "cover_id": ""})
	got = update(map[string]any{"kind": "video"})
	if !reflect.DeepEqual(got.AssetIDs, []string{clip.ID}) || got.CoverID != first.ID {
		t.Fatal("video selection/cover lost")
	}
	// A separate database connection proves this survives reopening the editor.
	reopened, err := store.Open(a.Config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	stored, err := store.Get[domain.Project](reopened.DB, "projects", p.ID)
	if err != nil || !reflect.DeepEqual(stored.MediaSelections["image"].AssetIDs, []string{first.ID, second.ID}) {
		t.Fatal("inactive draft not persisted")
	}
	update(map[string]any{"kind": "video", "asset_ids": []string{}, "cover_id": ""})
	got = update(map[string]any{"kind": "image"})
	if len(got.AssetIDs) != 2 {
		t.Fatal("clearing video cleared images")
	}
	got = update(map[string]any{"kind": "video"})
	if len(got.AssetIDs) != 0 || got.CoverID != "" {
		t.Fatal("explicit removal was not retained")
	}
	original, _ := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	snapshot, _ := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if original.Body != v.Body || snapshot.Kind != "image" || !reflect.DeepEqual(snapshot.AssetIDs, []string{second.ID, first.ID}) {
		t.Fatal("switch mutated text or an existing publication")
	}
}

func TestLegacyMediaSelectionAndInvalidChanges(t *testing.T) {
	a := testApp(t)
	image := sampleImage(t, a)
	legacy := domain.Project{ID: ID(), Name: "旧项目", Kind: "image", AssetIDs: []string{image.ID}, CoverID: image.ID}
	if err := store.Put(a.Store.DB, "projects", legacy.ID, legacy); err != nil {
		t.Fatal(err)
	}
	path := "/rewrites/" + legacy.ID
	request(t, a, "PATCH", path, map[string]any{"kind": "video", "asset_ids": []string{image.ID}}, 400)
	before, _ := store.Get[domain.Project](a.Store.DB, "projects", legacy.ID)
	if before.Kind != "image" || len(before.AssetIDs) != 1 {
		t.Fatal("invalid change altered legacy data")
	}
	request(t, a, "PATCH", path, map[string]any{"kind": "video"}, 200)
	got := decode[domain.Project](t, request(t, a, "PATCH", path, map[string]any{"kind": "image"}, 200))
	if !reflect.DeepEqual(got.AssetIDs, legacy.AssetIDs) || got.CoverID != legacy.CoverID {
		t.Fatal("legacy selection lost on first switch")
	}
}

func TestSelectingExistingMediaIsIdempotent(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "素材去重"}, 201))
	first, second := sampleImage(t, a), sampleImage(t, a)
	for i := 0; i < 2; i++ {
		got := decode[domain.Project](t, request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{second.ID, first.ID, second.ID}}, 200))
		if !reflect.DeepEqual(got.AssetIDs, []string{second.ID, first.ID}) {
			t.Fatal("duplicate selection changed order or retained duplicates")
		}
	}
	assets, _ := store.List[domain.Asset](a.Store.DB, "assets")
	versions, _ := store.List[domain.Version](a.Store.DB, "versions")
	if len(assets) != 2 || len(versions) != 0 {
		t.Fatal("selecting existing media copied an asset or created a version")
	}
}
