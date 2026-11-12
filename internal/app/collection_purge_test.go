package app

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func purgeFixture(t *testing.T, a *App) (domain.Note, domain.Asset, domain.Extraction) {
	t.Helper()
	n := domain.Note{ID: ID(), Platform: "xhs", NoteID: ID(), RevisionID: ID(), DeletedAt: Now()}
	n.URL = "https://www.xiaohongshu.com/explore/" + n.NoteID
	asset := sampleImage(t, a)
	asset.Source = "collection"
	asset.LibraryState = "collected"
	asset.RevisionID = n.RevisionID
	revision := domain.Revision{ID: n.RevisionID, NoteID: n.ID, AssetIDs: []string{asset.ID}}
	ex := domain.Extraction{ID: ID(), AssetID: asset.ID, Text: "提取原文"}
	for table, entry := range map[string]struct {
		id    string
		value any
	}{"notes": {n.ID, n}, "revisions": {revision.ID, revision}, "assets": {asset.ID, asset}, "extractions": {ex.ID, ex}} {
		if err := store.Put(a.Store.DB, table, entry.id, entry.value); err != nil {
			t.Fatal(err)
		}
	}
	return n, asset, ex
}

func TestPurgeUnreferencedDataAndDurableCleanup(t *testing.T) {
	a := testApp(t)
	n, asset, ex := purgeFixture(t, a)
	pending := newJob("ocr", asset.ID, nil)
	store.Put(a.Store.DB, "jobs", pending.ID, pending)
	response := decode[struct {
		Count     int
		CleanupID string `json:"cleanup_job_id"`
	}](t, request(t, a, "POST", "/collections/"+n.ID+"/purge", map[string]any{"confirm": true}, 200))
	if response.Count != 1 || response.CleanupID == "" {
		t.Fatal("missing cleanup job")
	}
	for table, id := range map[string]string{"notes": n.ID, "revisions": n.RevisionID, "assets": asset.ID, "extractions": ex.ID, "jobs": pending.ID} {
		if _, err := store.Get[map[string]any](a.Store.DB, table, id); err == nil {
			t.Fatalf("%s not removed", table)
		}
	}
	request(t, a, "POST", "/collections/"+n.ID+"/restore", map[string]any{}, 404)
	reopened, err := store.Open(a.Config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	cleanup, err := store.Get[domain.Job](reopened.DB, "jobs", response.CleanupID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.runCleanup(cleanup); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(a.Config.DataDir, "media", asset.Path)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unreferenced file not deleted")
	}
	if _, err = a.runCleanup(cleanup); err != nil {
		t.Fatal("cleanup retry is not idempotent", err)
	}
	// Deleting identity must permit a future fresh collection.
	got := decode[struct {
		Items []struct {
			JobID string `json:"job_id"`
		}
	}](t, request(t, a, "POST", "/collections", map[string]string{"text": n.URL}, 202))
	if len(got.Items) != 1 || got.Items[0].JobID == "" {
		t.Fatal("purged identity still deduplicated")
	}
}

func TestPurgeProtectsSourcesInactiveSelectionsPublicationsAndUploads(t *testing.T) {
	for _, reference := range []string{"source", "inactive-image", "cover", "publication", "extraction", "upload", "saved-library"} {
		t.Run(reference, func(t *testing.T) {
			a := testApp(t)
			n, asset, ex := purgeFixture(t, a)
			p := domain.Project{ID: ID(), Kind: "video"}
			switch reference {
			case "source":
				p.NoteID = n.ID
				p.RevisionID = n.RevisionID
			case "inactive-image":
				p.MediaSelections = map[string]domain.MediaSelection{"image": {AssetIDs: []string{asset.ID}}}
			case "cover":
				p.CoverID = asset.ID
			case "publication":
				store.Put(a.Store.DB, "publications", "published", domain.Publication{ID: "published", AssetIDs: []string{asset.ID}})
			case "extraction":
				p.Sources = []domain.Source{{ID: ex.ID, Text: ex.Text}}
			case "saved-library":
				asset.LibraryState = "saved"
				store.Put(a.Store.DB, "assets", asset.ID, asset)
			case "upload":
				asset.Source = "upload"
				store.Put(a.Store.DB, "assets", asset.ID, asset)
			}
			store.Put(a.Store.DB, "projects", p.ID, p)
			request(t, a, "POST", "/collections/batch-purge", map[string]any{"ids": []string{n.ID}, "confirm": true}, 200)
			if _, err := store.Get[domain.Note](a.Store.DB, "notes", n.ID); err == nil {
				t.Fatal("note not purged")
			}
			if _, err := store.Get[domain.Asset](a.Store.DB, "assets", asset.ID); err != nil {
				t.Fatal("referenced media removed")
			}
			request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)
			if reference == "source" {
				if _, err := store.Get[domain.Revision](a.Store.DB, "revisions", n.RevisionID); err != nil {
					t.Fatal("source revision removed")
				}
			}
		})
	}
}

func TestPurgeRequiresConfirmationTrashAndNoRunningTasks(t *testing.T) {
	a := testApp(t)
	n, asset, _ := purgeFixture(t, a)
	request(t, a, "POST", "/collections/"+n.ID+"/purge", map[string]any{}, 400)
	active := domain.Note{ID: ID(), NoteID: ID(), Platform: "xhs"}
	store.Put(a.Store.DB, "notes", active.ID, active)
	request(t, a, "POST", "/collections/batch-purge", map[string]any{"ids": []string{n.ID, active.ID}, "confirm": true}, 409)
	if _, err := store.Get[domain.Note](a.Store.DB, "notes", n.ID); err != nil {
		t.Fatal("batch partially deleted")
	}
	job := newJob("download", asset.ID, nil)
	job.State = "running"
	store.Put(a.Store.DB, "jobs", job.ID, job)
	request(t, a, "POST", "/collections/"+n.ID+"/purge", map[string]any{"confirm": true}, 409)
	job.Kind = "collect"
	job.Target = "https://xhslink.com/a/unknown"
	store.Put(a.Store.DB, "jobs", job.ID, job)
	request(t, a, "POST", "/collections/"+n.ID+"/purge", map[string]any{"confirm": true}, 409)
	if _, err := os.Stat(filepath.Join(a.Config.DataDir, "media", asset.Path)); err != nil {
		t.Fatal("busy file removed")
	}
}

func TestCleanupRejectsEscapesAndPreservesSharedFiles(t *testing.T) {
	a := testApp(t)
	asset := sampleImage(t, a)
	outside := filepath.Join(a.Config.DataDir, "private.txt")
	os.WriteFile(outside, []byte("keep"), 0600)
	for _, path := range []string{"../private.txt", outside, "."} {
		if _, err := a.runCleanup(newJob("cleanup", ID(), map[string]any{"paths": []string{path}})); err == nil {
			t.Fatal("unsafe cleanup path accepted")
		}
	}
	if _, err := a.runCleanup(newJob("cleanup", ID(), map[string]any{"paths": []string{asset.Path}})); err != nil {
		t.Fatal(err)
	}
	request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("outside file removed")
	}
}
