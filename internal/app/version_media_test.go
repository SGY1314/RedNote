package app

import (
	"reflect"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestVersionMediaSnapshotsOrderAndRetention(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "图片对比"}, 201))
	first, second := sampleImage(t, a), sampleImage(t, a)
	selection := func(ids []string) {
		request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": ids}, 200)
	}
	save := func() domain.Version {
		return decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"title": "同一文案", "body": "对比不同配图"}, 201))
	}
	selection([]string{first.ID, second.ID})
	v1 := save()
	selection([]string{second.ID, first.ID})
	v2 := save()
	selection([]string{})
	v3 := save()
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v1.ID+"/confirm", nil, 200)
	v1, _ = store.Get[domain.Version](a.Store.DB, "versions", v1.ID)
	if v1.Media == nil || !reflect.DeepEqual(v1.Media.AssetIDs, []string{first.ID, second.ID}) || v1.Media.Kind != "image" {
		t.Fatal("first version changed", v1.Media)
	}
	if v2.Media == nil || !reflect.DeepEqual(v2.Media.AssetIDs, []string{second.ID, first.ID}) {
		t.Fatal("second version order lost", v2.Media)
	}
	if v3.Media == nil || len(v3.Media.AssetIDs) != 0 {
		t.Fatal("empty snapshot confused with legacy", v3.Media)
	}
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{first.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{first.ID}, "confirm": true}, 409)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{first.ID}, "confirm": true}, 200)
	legacy := domain.Version{ID: ID(), ProjectID: "old", Content: domain.Content{Title: "旧版", Body: "正文"}}
	store.Put(a.Store.DB, "versions", legacy.ID, legacy)
	old, _ := store.Get[domain.Version](a.Store.DB, "versions", legacy.ID)
	if old.Media != nil {
		t.Fatal("invented legacy images")
	}
}

func TestWholeVersionPublicationIntegrity(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "整体版本"}, 201))
	one, two := sampleImage(t, a), sampleImage(t, a)
	// A different project draft must never substitute the media sent with this version.
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{two.ID}}, 200)
	media := domain.VersionMedia{Kind: "image", AssetIDs: []string{one.ID, two.ID}, CoverID: one.ID}
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "文案 A", "body": "完整版本 A", "media": media}, 201))
	if v.Media == nil || !reflect.DeepEqual(*v.Media, media) {
		t.Fatal("media was mixed with project draft", v)
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", nil, 200)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{two.ID}, "cover_id": ""}, 200)
	for _, other := range []map[string]any{
		{"kind": "video"}, {"asset_ids": []string{two.ID, one.ID}}, {"asset_ids": []string{}}, {"cover_id": two.ID}, {"cover_id": ""},
	} {
		other["version_id"] = v.ID
		request(t, a, "POST", "/publications", other, 409)
	}
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]any{"version_id": v.ID, "target_platform": "douyin"}, 201))
	if pub.Title != v.Title || pub.Body != v.Body || pub.CoverID != media.CoverID || pub.Kind != media.Kind || !reflect.DeepEqual(pub.AssetIDs, media.AssetIDs) {
		t.Fatal("publication does not match complete version", pub)
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"parent_id": v.ID, "title": "文案 B", "body": "完整版本 B", "media": domain.VersionMedia{Kind: "image", AssetIDs: []string{two.ID}}}, 201)
	saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if !reflect.DeepEqual(pub, saved) {
		t.Fatal("new complete version changed published snapshot")
	}
	for _, invalid := range []domain.VersionMedia{{Kind: "invalid"}, {Kind: "image", AssetIDs: []string{"missing"}}, {Kind: "image", AssetIDs: []string{one.ID, one.ID}}, {Kind: "image", CoverID: "missing"}} {
		request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "bad", "body": "bad", "media": invalid}, 400)
	}
	legacy := domain.Version{ID: ID(), ProjectID: p.ID, Status: "confirmed", Content: domain.Content{Title: "旧文案", Body: "历史"}}
	store.Put(a.Store.DB, "versions", legacy.ID, legacy)
	request(t, a, "POST", "/publications", map[string]any{"version_id": legacy.ID, "kind": "image", "asset_ids": []string{one.ID}}, 409)
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+legacy.ID+"/confirm", nil, 409)
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "test", "model": "test", "base_url": "https://example.com/v1", "secret": "test-key"}, 200))
	r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]any{"model_id": m.ID, "requirements": "同一套文案和图片", "media": media}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	frozen, err := jobVersionMedia(j)
	if err != nil || frozen == nil || !reflect.DeepEqual(*frozen, media) {
		t.Fatal("generation request media replaced by current project", frozen, err)
	}
}
