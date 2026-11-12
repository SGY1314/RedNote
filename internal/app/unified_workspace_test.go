package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestUnifiedWorkspaceMixedCollectionAndProjectOrigins(t *testing.T) {
	a := testApp(t)
	request(t, a, "POST", "/collections", map[string]string{"text": "https://www.xiaohongshu.com/explore/abc123 https://www.douyin.com/video/7590997226031002619"}, 202)
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 2 {
		t.Fatal("mixed platform collection was not queued")
	}
	for _, platform := range []string{"xhs", "douyin"} {
		noteID, _ := collectMediaFixture(t, a, platform, "123")
		p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": noteID}, 201))
		if p.Platform != platform {
			t.Fatal("source platform lost without workspace filter")
		}
	}
	projects := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites", nil, 200))
	if len(projects) != 2 {
		t.Fatal("unified project list is incomplete")
	}
	notes := decode[struct {
		Items []domain.Note `json:"items"`
	}](t, request(t, a, "GET", "/collections", nil, 200))
	if len(notes.Items) != 2 {
		t.Fatal("unified collection list is incomplete")
	}
}

func TestUnifiedWorkspaceIndependentPublicationTargets(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "统一创作"}, 201))
	asset := sampleImage(t, a)
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{asset.ID}}, 200)
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "确认标题", "body": "发布内容", "topics": []string{}}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", map[string]any{}, 200)
	for _, platform := range []string{"xhs", "douyin"} {
		pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]string{"target_platform": platform, "version_id": v.ID}, 201))
		if pub.TargetPlatform != platform || pub.VersionID != v.ID || pub.Title != v.Title || len(pub.AssetIDs) != 1 || pub.AssetIDs[0] != asset.ID || pub.PublishedAt != "" {
			t.Fatal("publication target or immutable content mismatch")
		}
	}
	pubs := decode[[]domain.Publication](t, request(t, a, "GET", "/publications", nil, 200))
	if len(pubs) != 2 || pubs[0].ID == pubs[1].ID {
		t.Fatal("platform publication snapshots were merged")
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 0 {
		t.Fatal("preparing a draft must not automatically publish")
	}
}
