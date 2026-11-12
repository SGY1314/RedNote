package app

import (
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestRewriteFormatsCreateFromSourceAndBlank(t *testing.T) {
	a := testApp(t)
	for _, kind := range []string{"image", "video"} {
		p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "单独创作", "kind": kind}, 201))
		if p.Kind != kind || len(p.MediaSelections) != 1 {
			t.Fatal("blank project format not isolated", p)
		}
	}
	request(t, a, "POST", "/rewrites", map[string]string{"kind": "other"}, 400)
	video := domain.Asset{ID: ID(), Kind: "video", Status: "ready"}
	image := sampleImage(t, a)
	store.Put(a.Store.DB, "assets", video.ID, video)
	rev := domain.Revision{ID: ID(), Kind: "video", Title: "原视频", AssetIDs: []string{video.ID, image.ID}}
	note := domain.Note{ID: ID(), Platform: "xhs", Kind: "video", RevisionID: rev.ID}
	store.Put(a.Store.DB, "revisions", rev.ID, rev)
	store.Put(a.Store.DB, "notes", note.ID, note)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": note.ID}, 201))
	if p.Kind != "video" {
		t.Fatal("source video classified as image")
	}
	detail := decode[struct {
		Images []domain.Asset `json:"reference_assets"`
		Videos []domain.Asset `json:"reference_videos"`
	}](t, request(t, a, "GET", "/rewrites/"+p.ID, nil, 200))
	if len(detail.Images) != 1 || len(detail.Videos) != 1 || detail.Videos[0].ID != video.ID {
		t.Fatal("reference media mixed")
	}
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "文案", "model": "fixture", "base_url": "https://example.com/v1", "secret": "test-key"}, 200))
	r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]any{"model_id": m.ID, "source_ids": []string{"original"}, "media": domain.VersionMedia{Kind: "video", AssetIDs: []string{}}}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	if !strings.Contains(asString(j.Payload["instructions"]), "视频仿写") || !strings.Contains(asString(j.Payload["instructions"]), "口播") {
		t.Fatal("video generation lacks video writing instructions")
	}
}
