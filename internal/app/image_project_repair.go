package app

import (
	"database/sql"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Repair only locally stored generated images with an unambiguous job owner.
// Preserve file paths, library state and all published snapshots.
func (a *App) repairImageProjectLinks() error {
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		return err
	}
	owners := map[string]string{}
	ambiguous := map[string]bool{}
	for _, j := range jobs {
		if j.Kind != "image_generation" {
			continue
		}
		ids := []string{j.ID, j.Result}
		if series, e := jobImageSeries(j); e == nil && series != nil {
			ids = append(ids, series.AssetIDs...)
		}
		for _, id := range ids {
			if id == "" {
				continue
			}
			if owner := owners[id]; owner != "" && owner != j.Target {
				ambiguous[id] = true
			}
			owners[id] = j.Target
		}
	}
	return a.Store.Transaction(func(tx *sql.Tx) error {
		for id, owner := range owners {
			if ambiguous[id] {
				continue
			}
			asset, e := store.Get[domain.Asset](tx, "assets", id)
			if e == sql.ErrNoRows {
				continue
			}
			if e != nil {
				return e
			}
			if asset.Source != "generated" || asset.Kind != "image" || asset.ProjectID != "" {
				continue
			}
			project, e := store.Get[domain.Project](tx, "projects", owner)
			if e == sql.ErrNoRows {
				continue
			}
			if e != nil {
				return e
			}
			asset.ProjectID, asset.ProjectName = project.ID, project.Name
			if e = store.Put(tx, "assets", id, asset); e != nil {
				return e
			}
		}
		return nil
	})
}
