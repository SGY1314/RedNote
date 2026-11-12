package app

import (
	"database/sql"
	"fmt"
	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Soft deletion only removes library visibility. Existing snapshots remain usable.
func (a *App) trashAssets(c *gin.Context) {
	var req struct {
		IDs     []string `json:"ids"`
		Deleted *bool    `json:"deleted"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 500 || req.Deleted == nil {
		fail(c, 400, "请选择 1 至 500 份素材并指定删除或恢复")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	assets := map[string]domain.Asset{}
	for _, id := range req.IDs {
		asset, ok := get[domain.Asset](a, c, "assets", id)
		if !ok {
			return
		}
		if *req.Deleted {
			if asset.DeletedAt == "" {
				asset.DeletedAt = Now()
			}
		} else {
			asset.DeletedAt = ""
		}
		asset.UpdatedAt = Now()
		assets[id] = asset
	}
	if err := a.Store.Transaction(func(tx *sql.Tx) error {
		for id, asset := range assets {
			if err := store.Put(tx, "assets", id, asset); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		fail(c, 500, "素材操作失败，记录未修改")
		return
	}
	c.JSON(200, gin.H{"count": len(assets)})
}

func (a *App) purgeAssets(c *gin.Context) {
	var req struct {
		IDs     []string `json:"ids"`
		Confirm bool     `json:"confirm"`
	}
	if !bind(c, &req) {
		return
	}
	if !req.Confirm || len(req.IDs) == 0 || len(req.IDs) > 500 {
		fail(c, 400, "请选择 1 至 500 份回收站素材并确认彻底删除")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	selected := map[string]domain.Asset{}
	for _, id := range req.IDs {
		asset, ok := get[domain.Asset](a, c, "assets", id)
		if !ok {
			return
		}
		if asset.DeletedAt == "" {
			fail(c, 409, "请先将素材移至回收站")
			return
		}
		selected[id] = asset
	}
	projects, err := store.List[domain.Project](a.Store.DB, "projects")
	if err != nil {
		fail(c, 500, "无法检查仿写引用")
		return
	}
	publications, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		fail(c, 500, "无法检查发布稿引用")
		return
	}
	revisions, err := store.List[domain.Revision](a.Store.DB, "revisions")
	if err != nil {
		fail(c, 500, "无法检查采集来源")
		return
	}
	notes, err := store.List[domain.Note](a.Store.DB, "notes")
	if err != nil {
		fail(c, 500, "无法检查采集笔记")
		return
	}
	liveNotes := map[string]bool{}
	for _, n := range notes {
		liveNotes[n.ID] = true
	}
	liveRevisions := map[string]bool{}
	for _, p := range projects {
		if p.RevisionID != "" {
			liveRevisions[p.RevisionID] = true
		}
	}
	extractions, err := store.List[domain.Extraction](a.Store.DB, "extractions")
	if err != nil {
		fail(c, 500, "无法检查文字提取")
		return
	}
	versions, err := store.List[domain.Version](a.Store.DB, "versions")
	if err != nil {
		fail(c, 500, "无法检查历史版本")
		return
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "无法检查后台任务")
		return
	}
	blocked := map[string]string{}
	keep := func(ids []string, cover, reason string) {
		for _, id := range append(append([]string{}, ids...), cover) {
			if _, ok := selected[id]; ok {
				blocked[id] = reason
			}
		}
	}
	scripts, err := store.List[videoScript](a.Store.DB, "video_scripts")
	if err != nil {
		bad(c, err)
		return
	}
	for _, s := range scripts {
		for _, ref := range s.References {
			keep([]string{ref.ID}, "", "视频脚本历史版本正在引用；彻底删除所属仿写项目后可清理")
		}
	}
	keepExtractions := map[string]bool{}
	for _, p := range projects {
		label := "仿写项目「" + p.Name + "」"
		if p.DeletedAt != "" {
			label += "（回收站）"
		}
		keep(p.AssetIDs, p.CoverID, label+"正在使用，请先移除项目中的素材或封面；回收站项目需恢复编辑或彻底删除")
		for _, s := range p.MediaSelections {
			keep(s.AssetIDs, s.CoverID, label+"的图文或视频选择仍在使用，请先移除对应素材或封面；回收站项目需恢复编辑或彻底删除")
		}
		for _, d := range p.Drafts {
			if d.Media != nil {
				keep(d.Media.AssetIDs, d.Media.CoverID, label+"的后台草稿正在引用，请先在草稿中移除素材")
			}
		}
		for _, s := range p.Sources {
			keepExtractions[s.ID] = true
		}
	}
	for _, v := range versions {
		if v.Media != nil {
			label := fmt.Sprintf("仿写历史版本 V%d", v.Number)
			if v.Generated {
				label = "文案试写历史"
			}
			keep(v.Media.AssetIDs, v.Media.CoverID, fmt.Sprintf("%s「%s」保留了该素材，供对比使用；需彻底删除所属项目后清理", label, v.Title))
		}
		for _, id := range v.SourceIDs {
			keepExtractions[id] = true
		}
	}
	for _, p := range publications {
		keep(p.AssetIDs, p.CoverID, "发布稿「"+p.Title+"」的快照正在使用；删除仿写项目不会删除发布稿，需保留原文件")
	}
	for _, r := range revisions {
		// Note deletion can retain a source snapshot for a rewrite. Once that
		// rewrite is also purged, the orphan snapshot must not pin every media
		// file forever. Publication and extraction references are checked separately.
		if !liveNotes[r.NoteID] && !liveRevisions[r.ID] {
			continue
		}
		reason := "采集笔记「" + r.Title + "」仍在使用；如需清理，请在对应平台采集库回收站彻底删除笔记"
		if !liveNotes[r.NoteID] {
			reason = "仿写项目仍保留「" + r.Title + "」的原文快照；请先彻底删除对应仿写项目"
		}
		keep(r.AssetIDs, "", reason)
		for id, asset := range selected {
			if asset.RevisionID == r.ID {
				blocked[id] = reason
			}
		}
	}
	removeExtractions := map[string]bool{}
	for _, x := range extractions {
		if _, ok := selected[x.AssetID]; ok {
			removeExtractions[x.ID] = true
			if keepExtractions[x.ID] {
				blocked[x.AssetID] = "仿写来源或历史版本正在使用该素材的提取文本，需保留原文件"
			}
		}
	}
	removeJobs := map[string]bool{}
	for _, j := range jobs {
		if isVideoJob(j.Kind) {
			var refs []videoReference
			_ = decodeVideoPayload(j, "references", &refs)
			if j.State == "queued" || j.State == "running" {
				for _, ref := range refs {
					keep([]string{ref.ID}, "", "视频脚本任务正在读取参考素材")
				}
			}
			var p videoProduction
			_ = decodeVideoPayload(j, "production", &p)
			for _, shot := range p.Shots {
				keep([]string{shot.AssetID}, "", "视频制作历史保留了该镜头；彻底删除所属仿写项目后可清理")
			}
			keep([]string{asString(j.Payload["asset_id"])}, asString(j.Payload["cover_id"]), "视频制作历史保留了该成片；彻底删除所属仿写项目后可清理")
		}

		if j.Kind == "rewrite" && (j.State == "queued" || j.State == "running") {
			media, e := jobVersionMedia(j)
			if e != nil {
				fail(c, 500, "无法检查文案任务的素材快照")
				return
			}
			if media != nil {
				keep(media.AssetIDs, media.CoverID, "文案生成任务正在保存版本素材，请任务结束后重试")
			}
		}
		if (j.Kind == "image_generation" || j.Kind == "image_plan") && (j.State == "queued" || j.State == "running") {
			series, e := jobImageSeries(j)
			if e != nil {
				fail(c, 500, "无法检查连续画面任务")
				return
			}
			if series != nil {
				keep(series.AssetIDs, "", "连续画面任务正在使用已生成图片，请任务结束后重试")
			}
			refs, e := jobImageReferences(j)
			if e != nil {
				fail(c, 500, "无法检查图片生成任务引用")
				return
			}
			for _, ref := range refs {
				keep([]string{ref.ID}, "", "AI 任务正在使用该参考图，请任务结束后重试")
			}
		}
		if _, ok := selected[j.Target]; ok && (j.Kind == "download" || j.Kind == "ocr" || j.Kind == "asr") {
			if j.State == "running" {
				blocked[j.Target] = "素材正在下载或提取文字，请任务结束后重试"
			}
			removeJobs[j.ID] = true
		}
	}
	if len(blocked) > 0 {
		details := []gin.H{}
		for id, reason := range blocked {
			details = append(details, gin.H{"id": id, "name": selected[id].Name, "reason": reason})
		}
		first := details[0]
		c.JSON(409, gin.H{"error": fmt.Sprintf("本次未删除任何素材。「%s」：%s（共 %d 份素材受保护）", first["name"], first["reason"], len(blocked)), "blocked": details})
		return
	}
	paths := []string{}
	for _, asset := range selected {
		if asset.Path != "" {
			paths = append(paths, asset.Path)
		}
	}
	cleanup := newJob("cleanup", ID(), map[string]any{"paths": paths})
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		for id := range selected {
			if err := store.Delete(tx, "assets", id); err != nil {
				return err
			}
		}
		for table, ids := range map[string]map[string]bool{"extractions": removeExtractions, "jobs": removeJobs} {
			for id := range ids {
				if err := store.Delete(tx, table, id); err != nil {
					return err
				}
			}
		}
		if len(paths) > 0 {
			return store.Put(tx, "jobs", cleanup.ID, cleanup)
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "彻底删除失败，记录未修改")
		return
	}
	cleanupID := ""
	if len(paths) > 0 {
		cleanupID = cleanup.ID
	}
	c.JSON(200, gin.H{"count": len(selected), "cleanup_job_id": cleanupID})
}
