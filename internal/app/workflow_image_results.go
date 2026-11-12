package app

import (
	"encoding/json"
	"errors"
	"slices"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) validateProjectImageResults(p domain.Project, media *domain.VersionMedia) error {
	return a.validateProjectMediaResults(p, media, "image")
}
func (a *App) validateProjectVideoResults(p domain.Project, media *domain.VersionMedia) error {
	return a.validateProjectMediaResults(p, media, "video")
}
func (a *App) validateProjectMediaResults(p domain.Project, media *domain.VersionMedia, kind string) error {
	label, jobKind, limit := "图片", "image_generation", 100
	if kind == "video" {
		label, jobKind, limit = "视频", "video_generate", 1
	}
	if media.Kind != kind || len(media.AssetIDs) == 0 || len(media.AssetIDs) > limit {
		return errors.New("请选择当前项目的" + label)
	}
	if err := a.validateVersionMedia(media); err != nil {
		return err
	}
	if kind == "image" && media.CoverID != "" && !slices.Contains(media.AssetIDs, media.CoverID) {
		return errors.New("封面必须是选中的图片")
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		return err
	}
	known := map[string]bool{}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		return err
	}
	var added struct {
		IDs      []string `json:"result_asset_ids"`
		Excluded []string `json:"excluded_result_asset_ids"`
	}
	if raw := w.Drafts[kind].Data; len(raw) > 0 {
		if err := json.Unmarshal(raw, &added); err != nil {
			return err
		}
	}
	if p.RevisionID != "" {
		revision, e := store.Get[domain.Revision](a.Store.DB, "revisions", p.RevisionID)
		if e != nil {
			return e
		}
		for _, id := range revision.AssetIDs {
			known[id] = true
		}
	}
	for _, job := range jobs {
		if job.Target != p.ID || job.Kind != jobKind {
			continue
		}
		known[job.ID], known[job.Result] = true, true
		if series, e := jobImageSeries(job); e == nil && series != nil {
			for _, id := range series.AssetIDs {
				known[id] = true
			}
		}
	}
	for _, id := range media.AssetIDs {
		if slices.Contains(added.Excluded, id) {
			return errors.New("所选" + label + "已从当前项目移除，请重新选择后确认")
		}
		asset, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		// The workspace store is scoped to the signed-in user. Sharing library
		// media between that user's projects requires explicit addition to this draft.
		libraryAdded := slices.Contains(added.IDs, id) && asset.LibraryState != "result" && asset.LibraryState != "collected" && asset.Status == "ready"
		projectResult := (asset.ProjectID == "" || asset.ProjectID == p.ID) && (known[id] || (p.RevisionID != "" && asset.RevisionID == p.RevisionID) || (asset.ProjectID == p.ID && (asset.Source == "generated" || asset.Source == "upload")))
		if e != nil || asset.DeletedAt != "" || !(projectResult || libraryAdded) {
			return errors.New("所选" + label + "不属于当前项目的可用素材")
		}
		f, e := a.openMedia(asset.Path)
		if e != nil {
			return errors.New(label + "文件不可用，请重新上传或下载")
		}
		info, e := f.Stat()
		f.Close()
		if e != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return errors.New(label + "文件不可用，请重新上传或下载")
		}
	}
	return nil
}
