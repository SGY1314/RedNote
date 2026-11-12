package app

import (
	"reflect"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func confirmedMultiPlatformVersion(t *testing.T, a *App) domain.Version {
	t.Helper()
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "双平台发布"}, 201))
	asset := sampleImage(t, a)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{asset.ID}}, 200)
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "同一篇内容", "body": "正文快照", "topics": []string{"日常"}}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", map[string]any{}, 200)
	return v
}

type multiPublicationResponse struct {
	Items   []domain.Publication `json:"items"`
	GroupID string               `json:"group_id"`
}

func TestMultiPlatformPublicationSnapshotsAndRetry(t *testing.T) {
	a := testApp(t)
	v := confirmedMultiPlatformVersion(t, a)
	before, _ := store.List[domain.Asset](a.Store.DB, "assets")
	body := map[string]string{"target_platform": "both", "version_id": v.ID, "request_id": "same-request"}
	created := decode[multiPublicationResponse](t, request(t, a, "POST", "/publications", body, 201))
	if len(created.Items) != 2 || created.GroupID == "" || created.Items[0].ID == created.Items[1].ID {
		t.Fatal("expected two distinct associated drafts")
	}
	for i, platform := range []string{"xhs", "douyin"} {
		p := created.Items[i]
		if p.TargetPlatform != platform || p.GroupID != created.GroupID || p.VersionID != v.ID || !reflect.DeepEqual(p.Content, v.Content) || !reflect.DeepEqual(p.AssetIDs, v.Media.AssetIDs) || !p.Ready || p.PublishedAt != "" {
			t.Fatal("draft did not preserve the confirmed version")
		}
	}
	// A lost creation response must not recreate a successful platform or reset a failure.
	created.Items[0].OnlineState = "published"
	created.Items[0].PublishedAt = Now()
	created.Items[1].OnlineState = "failed"
	for _, p := range created.Items {
		if err := store.Put(a.Store.DB, "publications", p.ID, p); err != nil {
			t.Fatal(err)
		}
	}
	retried := decode[multiPublicationResponse](t, request(t, a, "POST", "/publications", body, 200))
	if !reflect.DeepEqual(created, retried) {
		t.Fatal("retry changed existing snapshots or publication results")
	}
	pubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
	after, _ := store.List[domain.Asset](a.Store.DB, "assets")
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(pubs) != 2 || len(after) != len(before) || len(jobs) != 0 {
		t.Fatal("creation duplicated assets or automatically published")
	}
	body["target_platform"] = "xhs"
	request(t, a, "POST", "/publications", body, 409)
	body["target_platform"] = "both"
	body["version_id"] = "another-version"
	request(t, a, "POST", "/publications", body, 409)
}

func TestMultiPlatformPublicationAtomicFailureAndValidation(t *testing.T) {
	a := testApp(t)
	v := confirmedMultiPlatformVersion(t, a)
	body := map[string]string{"target_platform": "both", "version_id": v.ID, "request_id": "atomic-request"}
	_, err := a.Store.DB.Exec(`CREATE TRIGGER reject_douyin BEFORE INSERT ON publications WHEN json_extract(NEW.data, '$.target_platform') = 'douyin' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`)
	if err != nil {
		t.Fatal(err)
	}
	request(t, a, "POST", "/publications", body, 500)
	pubs, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil || len(pubs) != 0 {
		t.Fatal("partial publication survived transaction rollback", err)
	}
	if _, err := a.Store.DB.Exec("DROP TRIGGER reject_douyin"); err != nil {
		t.Fatal(err)
	}
	request(t, a, "POST", "/publications", body, 201)
	delete(body, "request_id")
	request(t, a, "POST", "/publications", body, 400)
	body["target_platform"] = "unsupported"
	request(t, a, "POST", "/publications", body, 400)
	body["target_platform"] = "both"
	body["request_id"] = "unconfirmed-request"
	v.Status = "draft"
	if err := store.Put(a.Store.DB, "versions", v.ID, v); err != nil {
		t.Fatal(err)
	}
	request(t, a, "POST", "/publications", body, 409)
}
