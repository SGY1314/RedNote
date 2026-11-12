package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestProjectPurgeKeepsIndependentPublicationAndAssets(t *testing.T) {
	a := testApp(t)
	p := domain.Project{ID: ID(), Name: "待清理", DeletedAt: Now(), RevisionID: ID()}
	other := domain.Project{ID: ID(), Name: "保留"}
	asset := sampleImage(t, a)
	r := domain.Revision{ID: p.RevisionID, AssetIDs: []string{asset.ID}}
	v := domain.Version{ID: ID(), ProjectID: p.ID, Status: "confirmed", Content: domain.Content{Title: "保留发布标题", Body: "已确认发布正文"}}
	draft := domain.Version{ID: ID(), ProjectID: p.ID, Status: "draft"}
	otherVersion := domain.Version{ID: ID(), ProjectID: other.ID}
	j := newJob("rewrite", p.ID, nil)
	j.State = "succeeded"
	j.Result = v.ID
	pub := domain.Publication{ID: ID(), ProjectID: p.ID, VersionID: v.ID, Content: v.Content, Kind: "image", Ready: true, AssetIDs: []string{asset.ID}}
	export := newJob("export", pub.ID, nil)
	for table, entries := range map[string]map[string]any{
		"projects": {p.ID: p, other.ID: other}, "versions": {v.ID: v, draft.ID: draft, otherVersion.ID: otherVersion},
		"revisions": {r.ID: r}, "jobs": {j.ID: j, export.ID: export}, "publications": {pub.ID: pub},
		"settings": {"rewrite-job-" + j.ID: domain.Service{Model: "fixture"}},
	} {
		for id, value := range entries {
			if err := store.Put(a.Store.DB, table, id, value); err != nil {
				t.Fatal(err)
			}
		}
	}
	response := decode[struct{ Count int }](t, request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID, p.ID}, "confirm": true}, 200))
	if response.Count != 1 {
		t.Fatal("duplicate IDs counted twice")
	}
	for table, ids := range map[string][]string{"projects": {p.ID}, "versions": {v.ID, draft.ID}, "jobs": {j.ID}, "settings": {"rewrite-job-" + j.ID}} {
		for _, id := range ids {
			if _, err := store.Get[map[string]any](a.Store.DB, table, id); err == nil {
				t.Fatal("record remains", table, id)
			}
		}
	}
	for table, ids := range map[string][]string{"projects": {other.ID}, "versions": {otherVersion.ID}, "publications": {pub.ID}, "revisions": {r.ID}, "assets": {asset.ID}, "jobs": {export.ID}} {
		for _, id := range ids {
			if _, err := store.Get[map[string]any](a.Store.DB, table, id); err != nil {
				t.Fatal("independent record lost", table, id)
			}
		}
	}
	request(t, a, "GET", "/rewrites/"+p.ID, nil, 404)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": false}, 404)
	snapshot, err := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if err != nil || snapshot.Body != pub.Body || len(snapshot.AssetIDs) != 1 || snapshot.AssetIDs[0] != asset.ID {
		t.Fatal("purge lost publication snapshot")
	}
	f, err := a.openMedia(asset.Path)
	if err != nil {
		t.Fatal("purge removed publication media", err)
	}
	f.Close()

}

func TestProjectPurgeRequiresConfirmationTrashAndAtomicBatch(t *testing.T) {
	a := testApp(t)
	p := domain.Project{ID: ID(), DeletedAt: Now()}
	active := domain.Project{ID: ID()}
	store.Put(a.Store.DB, "projects", p.ID, p)
	store.Put(a.Store.DB, "projects", active.ID, active)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID}}, 400)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{}, "confirm": true}, 400)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID, active.ID}, "confirm": true}, 409)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID, "missing"}, "confirm": true}, 404)
	if _, err := store.Get[domain.Project](a.Store.DB, "projects", p.ID); err != nil {
		t.Fatal("partial deletion")
	}
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{active.ID}, "deleted": true}, 200)
	for _, state := range []string{"queued", "running"} {
		j := newJob("rewrite", active.ID, nil)
		j.State = state
		store.Put(a.Store.DB, "jobs", j.ID, j)
		request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID, active.ID}, "confirm": true}, 409)
		if _, err := store.Get[domain.Project](a.Store.DB, "projects", p.ID); err != nil {
			t.Fatal("active job caused partial deletion")
		}
		store.Delete(a.Store.DB, "jobs", j.ID)
	}
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID, active.ID}, "confirm": true}, 200)
	if all := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites?include_deleted=true", nil, 200)); len(all) != 0 {
		t.Fatal("purged projects remain")
	}
}
