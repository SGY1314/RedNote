package app

import (
	"database/sql"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Caller holds a.mu. Only current active revisions are backfilled; failed saves
// remain available for explicit retry rather than looping on every restart.
func (a *App) queueCollectionBackfill() {
	notes, err := store.List[domain.Note](a.Store.DB, "notes")
	if err != nil {
		return
	}
	active := map[string]bool{}
	for _, n := range notes {
		if n.DeletedAt == "" {
			active[n.RevisionID] = true
		}
	}
	assets, err := store.List[domain.Asset](a.Store.DB, "assets")
	if err != nil {
		return
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		return
	}
	queued := map[string]bool{}
	for _, j := range jobs {
		if j.Kind == "download" && (j.State == "queued" || j.State == "running") {
			queued[j.Target] = true
		}
	}
	_ = a.Store.Transaction(func(tx *sql.Tx) error {
		for _, v := range assets {
			if v.Source != "collection" || v.DeletedAt != "" || !active[v.RevisionID] || v.RemoteURL == "" || v.Status == "ready" || v.Status == "failed" || queued[v.ID] {
				continue
			}
			v.Status, v.Error, v.LibraryState = "pending", "", "collected"
			j := newJob("download", v.ID, map[string]any{"trigger": "collection_auto"})
			if err := store.Put(tx, "assets", v.ID, v); err != nil {
				return err
			}
			if err := store.Put(tx, "jobs", j.ID, j); err != nil {
				return err
			}
		}
		return nil
	})
}
