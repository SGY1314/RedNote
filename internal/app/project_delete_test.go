package app

import (
	"bytes"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestProjectTrashPreservesVersionsMediaAndPublication(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "保留发布快照"}, 201))
	asset := sampleImage(t, a)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{asset.ID}, "cover_id": asset.ID}, 200)
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "标题", "body": "正文"}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", nil, 200)
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]any{"version_id": v.ID, "kind": "image", "asset_ids": []string{asset.ID}}, 201))
	file := request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)
	for i := 0; i < 2; i++ {
		request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID, p.ID}, "deleted": true}, 200)
	}
	if got := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites", nil, 200)); len(got) != 0 {
		t.Fatal("deleted project still in default list")
	}
	all := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites?include_deleted=true", nil, 200))
	if len(all) != 1 || all[0].DeletedAt == "" || all[0].CoverID != asset.ID {
		t.Fatal("trash lost project")
	}
	request(t, a, "GET", "/rewrites/"+p.ID, nil, 200)
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"title": "不允许", "body": "写入"}, 409)
	request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]string{"requirements": "写一篇"}, 409)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{}}, 409)
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", nil, 409)
	request(t, a, "POST", "/publications", map[string]any{"version_id": v.ID, "kind": "image"}, 409)
	j := newJob("rewrite", p.ID, nil)
	j.State = "failed"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/jobs/"+j.ID+"/retry", nil, 409)
	if !bytes.Equal(file, request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)) {
		t.Fatal("media lost")
	}
	saved, err := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if err != nil || saved.Body != pub.Body || saved.VersionID != v.ID || saved.AssetIDs[0] != asset.ID {
		t.Fatal("publication changed")
	}
	versions, _ := store.List[domain.Version](a.Store.DB, "versions")
	if len(versions) != 1 || versions[0].Status != "confirmed" {
		t.Fatal("version changed")
	}
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": false}, 200)
	restored := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites", nil, 200))
	if len(restored) != 1 || restored[0].ID != p.ID || restored[0].MediaSelections["image"].AssetIDs[0] != asset.ID {
		t.Fatal("restore lost media")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"title": "恢复后", "body": "可以继续编辑"}, 201)
}

func TestProjectTrashBatchAtomicAndActiveJobs(t *testing.T) {
	a := testApp(t)
	p := domain.Project{ID: ID(), Name: "项目一"}
	q := domain.Project{ID: ID(), Name: "项目二"}
	store.Put(a.Store.DB, "projects", p.ID, p)
	store.Put(a.Store.DB, "projects", q.ID, q)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID, "missing"}, "deleted": true}, 404)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}}, 400)
	j := newJob("rewrite", q.ID, nil)
	store.Put(a.Store.DB, "jobs", j.ID, j)
	ids := []string{p.ID, q.ID}
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": ids, "deleted": true}, 409)
	for _, id := range ids {
		got, _ := store.Get[domain.Project](a.Store.DB, "projects", id)
		if got.DeletedAt != "" {
			t.Fatal("partial deletion")
		}
	}
	j.State = "running"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": ids, "deleted": true}, 409)
	j.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": ids, "deleted": true}, 200)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": ids, "deleted": false}, 200)
	if got := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites", nil, 200)); len(got) != 2 {
		t.Fatal("batch restore failed")
	}
}
