package app

import (
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) tagVideoAsset(asset *domain.Asset, script videoScript) {
	asset.ProjectID, asset.ScriptID, asset.ScriptTitle = script.ProjectID, script.ID, script.Title
	if project, err := store.Get[domain.Project](a.Store.DB, "projects", script.ProjectID); err == nil {
		asset.ProjectName = project.Name
	}
}
