package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestPlatformWorkspacesCreateAndFilterProjects(t *testing.T) {
	a := testApp(t)
	for _, platform := range []string{"xhs", "douyin"} {
		note := domain.Note{ID: ID(), Platform: platform, RevisionID: ID()}
		rev := domain.Revision{ID: note.RevisionID, NoteID: note.ID, Title: platform + " source"}
		if err := store.Put(a.Store.DB, "notes", note.ID, note); err != nil {
			t.Fatal(err)
		}
		if err := store.Put(a.Store.DB, "revisions", rev.ID, rev); err != nil {
			t.Fatal(err)
		}
		p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": note.ID, "platform": platform}, 201))
		if p.Platform != platform || p.RevisionID != rev.ID {
			t.Fatal("project lost platform or provenance")
		}
		manual := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"platform": platform, "name": "manual"}, 201))
		if manual.Platform != platform {
			t.Fatal("manual project in wrong workspace")
		}
		opposite := "douyin"
		if platform == "douyin" {
			opposite = "xhs"
		}
		request(t, a, "POST", "/rewrites", map[string]string{"note_id": note.ID, "platform": opposite}, 400)
		manual.DeletedAt = Now()
		store.Put(a.Store.DB, "projects", manual.ID, manual)
	}
	for _, platform := range []string{"xhs", "douyin"} {
		active := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites?platform="+platform, nil, 200))
		all := decode[[]domain.Project](t, request(t, a, "GET", "/rewrites?platform="+platform+"&include_deleted=true", nil, 200))
		if len(active) != 1 || len(all) != 2 {
			t.Fatal("incorrect workspace/trash filtering")
		}
		for _, p := range all {
			if p.Platform != platform {
				t.Fatal("cross-platform project leak")
			}
		}
	}
}

func TestPlatformCollectionRejectsMixedBatchBeforeEnqueue(t *testing.T) {
	a := testApp(t)
	xhs := "https://www.xiaohongshu.com/explore/abc123"
	dy := "https://www.douyin.com/video/7590997226031002619"
	for _, platform := range []string{"xhs", "douyin"} {
		request(t, a, "POST", "/collections", map[string]string{"platform": platform, "text": xhs + " " + dy}, 400)
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 0 {
		t.Fatal("mixed batch partially queued")
	}
	request(t, a, "POST", "/collections", map[string]string{"platform": "douyin", "text": dy}, 202)
	jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 1 || jobs[0].Target != dy {
		t.Fatal("valid platform request missing")
	}
}

func TestProjectPlatformMigrationPreservesLegacyContent(t *testing.T) {
	a := testApp(t)
	n := domain.Note{ID: ID(), Platform: "douyin"}
	store.Put(a.Store.DB, "notes", n.ID, n)
	source := domain.Project{ID: ID(), NoteID: n.ID, Name: "keep source", Sources: []domain.Source{{ID: "original", Text: "keep full original"}}}
	manual := domain.Project{ID: ID(), Name: "manual"}
	fallback := domain.Project{ID: ID(), Name: "legacy xhs", DeletedAt: Now()}
	for _, p := range []domain.Project{source, manual, fallback} {
		store.Put(a.Store.DB, "projects", p.ID, p)
	}
	publication := domain.Publication{ID: ID(), ProjectID: manual.ID, TargetPlatform: "douyin", Content: domain.Content{Title: "snapshot"}}
	store.Put(a.Store.DB, "publications", publication.ID, publication)
	other, err := store.Open(a.Config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer other.DB.Close()
	for id, want := range map[string]string{source.ID: "douyin", manual.ID: "douyin", fallback.ID: "xhs"} {
		p, err := store.Get[domain.Project](other.DB, "projects", id)
		if err != nil || p.Platform != want {
			t.Fatalf("migration %s: %+v %v", want, p, err)
		}
		if id == source.ID && (p.Name != source.Name || p.Sources[0].Text != "keep full original") {
			t.Fatal("source was modified")
		}
		if id == fallback.ID && p.DeletedAt != fallback.DeletedAt {
			t.Fatal("trash state changed")
		}
	}
	pub, _ := store.Get[domain.Publication](other.DB, "publications", publication.ID)
	if pub.Title != "snapshot" || pub.TargetPlatform != "douyin" {
		t.Fatal("publication changed")
	}
}
