package app

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestAssetTrashRestorePreservesReferences(t *testing.T) {
	a := testApp(t)
	asset := sampleImage(t, a)
	p := domain.Project{ID: ID(), Kind: "image", AssetIDs: []string{asset.ID}, CoverID: asset.ID}
	pub := domain.Publication{ID: ID(), AssetIDs: []string{asset.ID}, CoverID: asset.ID}
	store.Put(a.Store.DB, "projects", p.ID, p)
	store.Put(a.Store.DB, "publications", pub.ID, pub)
	before := request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{asset.ID, "missing"}, "deleted": true}, 404)
	got, _ := store.Get[domain.Asset](a.Store.DB, "assets", asset.ID)
	if got.DeletedAt != "" {
		t.Fatal("batch partially changed")
	}
	for i := 0; i < 2; i++ {
		request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{asset.ID, asset.ID}, "deleted": true}, 200)
	}
	got, _ = store.Get[domain.Asset](a.Store.DB, "assets", asset.ID)
	if got.DeletedAt == "" {
		t.Fatal("not trashed")
	}
	if !bytes.Equal(before, request(t, a, "GET", "/assets/"+asset.ID+"/file", nil, 200)) {
		t.Fatal("snapshot file lost")
	}
	request(t, a, "PATCH", "/rewrites/"+p.ID, map[string]any{"kind": "image", "asset_ids": []string{asset.ID}}, 200)
	other := domain.Project{ID: ID(), Kind: "image"}
	store.Put(a.Store.DB, "projects", other.ID, other)
	request(t, a, "PATCH", "/rewrites/"+other.ID, map[string]any{"kind": "image", "asset_ids": []string{asset.ID}}, 409)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{asset.ID}, "deleted": false}, 200)
	got, _ = store.Get[domain.Asset](a.Store.DB, "assets", asset.ID)
	if got.DeletedAt != "" || got.Path != asset.Path {
		t.Fatal("restore failed")
	}
	saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if saved.CoverID != asset.ID {
		t.Fatal("publication changed")
	}
}

func TestAssetPurgeDurableCleanup(t *testing.T) {
	a := testApp(t)
	asset := sampleImage(t, a)
	body := map[string]any{"ids": []string{asset.ID}, "confirm": true}
	request(t, a, "POST", "/assets/batch-purge", body, 409)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{asset.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{asset.ID}}, 400)
	ex := domain.Extraction{ID: ID(), AssetID: asset.ID}
	j := newJob("ocr", asset.ID, nil)
	store.Put(a.Store.DB, "extractions", ex.ID, ex)
	store.Put(a.Store.DB, "jobs", j.ID, j)
	response := decode[struct {
		CleanupID string `json:"cleanup_job_id"`
	}](t, request(t, a, "POST", "/assets/batch-purge", body, 200))
	if response.CleanupID == "" {
		t.Fatal("missing durable cleanup")
	}
	for table, id := range map[string]string{"assets": asset.ID, "extractions": ex.ID, "jobs": j.ID} {
		if _, err := store.Get[map[string]any](a.Store.DB, table, id); err == nil {
			t.Fatal("record remains", table)
		}
	}
	cleanup, err := store.Get[domain.Job](a.Store.DB, "jobs", response.CleanupID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.runCleanup(cleanup); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(a.Config.DataDir, "media", asset.Path)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("file not removed", err)
	}
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{asset.ID}, "deleted": false}, 404)
}

func TestAssetPurgeProtectsReferencesAndAtomicBatch(t *testing.T) {
	for _, reference := range []string{"project", "inactive", "cover", "publication", "revision", "source_snapshot", "extraction", "running"} {
		t.Run(reference, func(t *testing.T) {
			a := testApp(t)
			asset, spare := sampleImage(t, a), sampleImage(t, a)
			p := domain.Project{ID: ID(), Kind: "image"}
			switch reference {
			case "project":
				p.AssetIDs = []string{asset.ID}
			case "inactive":
				p.MediaSelections = map[string]domain.MediaSelection{"image": {AssetIDs: []string{asset.ID}}}
			case "cover":
				p.CoverID = asset.ID
			case "publication":
				pub := domain.Publication{ID: ID(), CoverID: asset.ID}
				store.Put(a.Store.DB, "publications", pub.ID, pub)
			case "revision":
				n := domain.Note{ID: ID(), DeletedAt: Now()}
				store.Put(a.Store.DB, "notes", n.ID, n)
				r := domain.Revision{ID: ID(), NoteID: n.ID, AssetIDs: []string{asset.ID}}
				store.Put(a.Store.DB, "revisions", r.ID, r)
			case "source_snapshot":
				r := domain.Revision{ID: ID(), NoteID: "purged-note", AssetIDs: []string{asset.ID}}
				p.RevisionID = r.ID
				p.DeletedAt = Now()
				store.Put(a.Store.DB, "revisions", r.ID, r)
			case "extraction":
				x := domain.Extraction{ID: ID(), AssetID: asset.ID}
				store.Put(a.Store.DB, "extractions", x.ID, x)
				v := domain.Version{ID: ID(), SourceIDs: []string{x.ID}}
				store.Put(a.Store.DB, "versions", v.ID, v)
			case "running":
				j := newJob("download", asset.ID, nil)
				j.State = "running"
				store.Put(a.Store.DB, "jobs", j.ID, j)
			}
			store.Put(a.Store.DB, "projects", p.ID, p)
			ids := []string{spare.ID, asset.ID}
			request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": ids, "deleted": true}, 200)
			request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": ids, "confirm": true}, 409)
			for _, id := range ids {
				if _, err := store.Get[domain.Asset](a.Store.DB, "assets", id); err != nil {
					t.Fatal("partial deletion", err)
				}
			}
		})
	}
}

func TestAssetPurgeAfterSourceAndRewriteDeleted(t *testing.T) {
	a := testApp(t)
	asset, published := sampleImage(t, a), sampleImage(t, a)
	r := domain.Revision{ID: ID(), NoteID: "already-purged", AssetIDs: []string{asset.ID, published.ID}}
	asset.RevisionID = r.ID
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	store.Put(a.Store.DB, "revisions", r.ID, r)
	p := domain.Project{ID: ID(), Name: "已删除项目", RevisionID: r.ID, DeletedAt: Now()}
	store.Put(a.Store.DB, "projects", p.ID, p)
	pub := domain.Publication{ID: ID(), AssetIDs: []string{published.ID}, Content: domain.Content{Title: "保留发布稿"}}
	store.Put(a.Store.DB, "publications", pub.ID, pub)
	request(t, a, "POST", "/assets/batch-trash", map[string]any{"ids": []string{asset.ID, published.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{asset.ID}, "confirm": true}, 409)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 200)
	// An orphan source must not override a real publication reference or block
	// unreferenced media merely because the historical snapshot still exists.
	request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{asset.ID, published.ID}, "confirm": true}, 409)
	response := decode[struct {
		CleanupID string `json:"cleanup_job_id"`
	}](t, request(t, a, "POST", "/assets/batch-purge", map[string]any{"ids": []string{asset.ID}, "confirm": true}, 200))
	if _, err := store.Get[domain.Asset](a.Store.DB, "assets", asset.ID); err == nil {
		t.Fatal("orphan media still retained")
	}
	if _, err := store.Get[domain.Asset](a.Store.DB, "assets", published.ID); err != nil {
		t.Fatal("publication media removed")
	}
	cleanup, err := store.Get[domain.Job](a.Store.DB, "jobs", response.CleanupID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.runCleanup(cleanup); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(a.Config.DataDir, "media", asset.Path)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("orphan file not cleaned", err)
	}
}
