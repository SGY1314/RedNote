package app

import (
	"reflect"
	"strings"
	"testing"
	"time"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestPublicationTrashRestoreAndPurgePreserveSources(t *testing.T) {
	a := testApp(t)
	asset := sampleImage(t, a)
	project := domain.Project{ID: ID(), Name: "项目", AssetIDs: []string{asset.ID}}
	version := domain.Version{ID: ID(), ProjectID: project.ID, Status: "confirmed"}
	p := domain.Publication{ID: ID(), ProjectID: project.ID, VersionID: version.ID, Kind: "image", TargetPlatform: "xhs", Content: domain.Content{Title: "标题", Body: "正文", Topics: []string{"生活"}}, AssetIDs: []string{asset.ID}, Ready: true, PublishedAt: Now(), PublishedURL: "https://www.xiaohongshu.com/explore/test"}
	for table, value := range map[string]struct {
		id string
		v  any
	}{"projects": {project.ID, project}, "versions": {version.ID, version}, "publications": {p.ID, p}} {
		if err := store.Put(a.Store.DB, table, value.id, value.v); err != nil {
			t.Fatal(err)
		}
	}
	request(t, a, "POST", "/publications/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 409)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID, p.ID}, "deleted": true}, 200)
	trashed, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if trashed.DeletedAt == "" {
		t.Fatal("missing deletion timestamp")
	}
	trashed.DeletedAt = ""
	if !reflect.DeepEqual(trashed, p) {
		t.Fatal("publication snapshot was modified")
	}
	if active := decode[[]domain.Publication](t, request(t, a, "GET", "/publications", nil, 200)); len(active) != 0 {
		t.Fatal("trash appeared in active list")
	}
	for _, path := range []string{"/publications?deleted=true", "/publications?include_deleted=true"} {
		if all := decode[[]domain.Publication](t, request(t, a, "GET", path, nil, 200)); len(all) != 1 {
			t.Fatal("trash missing", path)
		}
	}
	request(t, a, "PATCH", "/publications/"+p.ID, map[string]any{"published_at": Now()}, 409)
	request(t, a, "POST", "/publications/"+p.ID+"/mobile-handoff", map[string]any{"request_id": strings.Repeat("a", 32)}, 409)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": false}, 200)
	restored, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if !reflect.DeepEqual(restored, p) {
		t.Fatal("restoring changed the snapshot")
	}
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/publications/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": false}, 400)
	request(t, a, "POST", "/publications/batch-purge", map[string]any{"ids": []string{p.ID, p.ID}, "confirm": true}, 200)
	if _, err := store.Get[domain.Publication](a.Store.DB, "publications", p.ID); err == nil {
		t.Fatal("publication not purged")
	}
	for table, id := range map[string]string{"projects": project.ID, "versions": version.ID, "assets": asset.ID} {
		if _, err := store.Get[map[string]any](a.Store.DB, table, id); err != nil {
			t.Fatal("independent record removed", table, err)
		}
	}
}

func TestPublicationTrashAtomicityAndActiveHandoffs(t *testing.T) {
	a := testApp(t)
	p := domain.Publication{ID: ID(), Content: domain.Content{Title: "发布稿"}}
	store.Put(a.Store.DB, "publications", p.ID, p)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID, "missing"}, "deleted": true}, 404)
	j := newJob("publish", p.ID, nil)
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 409)
	store.Delete(a.Store.DB, "jobs", j.ID)
	expires := time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)
	store.Put(a.Store.DB, "mobile_handoffs", p.ID, mobileHandoffRecord{Session: miniappCloudSession{State: "created", ExpiresAt: expires}})
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 409)
	store.Delete(a.Store.DB, "mobile_handoffs", p.ID)
	store.Put(a.Store.DB, "mobile_handoffs", "douyin:"+p.ID, douyinHandoffRecord{Session: douyinMobileSession{State: "ready", ExpiresAt: expires}})
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 409)
	unchanged, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if unchanged.DeletedAt != "" {
		t.Fatal("failed batch changed a publication")
	}
	store.Delete(a.Store.DB, "mobile_handoffs", "douyin:"+p.ID)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}}, 400)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
}
