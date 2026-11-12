package app

import (
	"github.com/gin-gonic/gin"
	"slices"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Older project documents hold only the active selection. Seed that selection
// lazily so existing projects retain it when switching formats for the first time.
func ensureMediaSelections(p *domain.Project) {
	if p.Kind == "" {
		p.Kind = "image"
	}
	if p.MediaSelections == nil {
		p.MediaSelections = map[string]domain.MediaSelection{}
	}
	if _, exists := p.MediaSelections[p.Kind]; !exists {
		p.MediaSelections[p.Kind] = domain.MediaSelection{AssetIDs: append([]string{}, p.AssetIDs...), CoverID: p.CoverID}
	}
}

func (a *App) projectMedia(c *gin.Context) {
	var req struct {
		AssetIDs []string `json:"asset_ids"`
		Kind     string   `json:"kind"`
		CoverID  *string  `json:"cover_id"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Kind != "image" && req.Kind != "video" {
		fail(c, 400, "请选择图文或视频")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	ensureMediaSelections(&p)
	selection, exists := p.MediaSelections[req.Kind]
	previousIDs := map[string]bool{}
	for _, id := range selection.AssetIDs {
		previousIDs[id] = true
	}
	previousCover := selection.CoverID
	if !exists {
		selection.AssetIDs = []string{}
	}
	// Omitted asset_ids switches format; an explicit [] clears only this format.
	if req.AssetIDs != nil {
		selection.AssetIDs = []string{}
		seen := map[string]bool{}
		for _, id := range req.AssetIDs {
			if !seen[id] {
				selection.AssetIDs = append(selection.AssetIDs, id)
				seen[id] = true
			}
		}
	}
	if req.CoverID != nil {
		selection.CoverID = *req.CoverID
	}
	if req.Kind == "video" && len(selection.AssetIDs) > 1 {
		fail(c, 400, "只能选择一个发布视频")
		return
	}
	seen := map[string]bool{}
	for _, id := range selection.AssetIDs {
		if seen[id] {
			fail(c, 400, "素材不能重复")
			return
		}
		seen[id] = true
		v, ok := get[domain.Asset](a, c, "assets", id)
		if !ok {
			return
		}
		if v.Kind != req.Kind || v.Status != "ready" {
			fail(c, 400, "素材类型不匹配或尚未就绪")
			return
		}
		if v.DeletedAt != "" && !previousIDs[id] {
			fail(c, 409, "素材已在回收站，请先恢复再选择")
			return
		}
	}
	if selection.CoverID != "" {
		v, ok := get[domain.Asset](a, c, "assets", selection.CoverID)
		if !ok {
			return
		}
		if v.Kind != "image" || v.Status != "ready" {
			fail(c, 400, "封面必须是可用图片")
			return
		}
		if v.DeletedAt != "" && previousCover != v.ID {
			fail(c, 409, "封面素材已在回收站，请先恢复再选择")
			return
		}
	}
	if exists && p.Kind == req.Kind && p.CoverID == selection.CoverID && slices.Equal(p.AssetIDs, selection.AssetIDs) {
		c.JSON(200, p)
		return
	}
	p.MediaSelections[req.Kind] = selection
	p.AssetIDs = selection.AssetIDs
	p.Kind = req.Kind
	p.CoverID = selection.CoverID
	if e := store.Put(a.Store.DB, "projects", p.ID, p); e != nil {
		fail(c, 500, "保存素材选择失败")
		return
	}
	c.JSON(200, p)
}
