package app

import (
	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func publicationDraftID(p domain.Publication) string {
	if p.SharedDraftID != "" {
		return p.SharedDraftID
	}
	return p.ID
}

func linkedPublicationIDs(all []domain.Publication, ids []string) []string {
	roots, requested := map[string]bool{}, map[string]bool{}
	result := append([]string{}, ids...)
	for _, id := range ids {
		requested[id] = true
	}
	for _, p := range all {
		if requested[p.ID] {
			roots[publicationDraftID(p)] = true
		}
	}
	for _, p := range all {
		if roots[publicationDraftID(p)] && !requested[p.ID] {
			result = append(result, p.ID)
			requested[p.ID] = true
		}
	}
	return result
}

// A published platform freezes the shared content, while the other platform
// remains available. New confirmations must not overwrite that pending copy.
func publicationDraftPublished(p domain.Publication, all []domain.Publication) bool {
	for _, other := range all {
		sameSnapshot := publicationPlatform(other) != publicationPlatform(p) && other.ProjectID == p.ProjectID && ((p.VersionID != "" && other.VersionID == p.VersionID) || (p.GroupID != "" && other.GroupID == p.GroupID)) && samePublicationContent(other, domain.Version{Content: p.Content, Media: &domain.VersionMedia{Kind: p.Kind, AssetIDs: p.AssetIDs, CoverID: p.CoverID}})
		if (publicationDraftID(other) == publicationDraftID(p) || sameSnapshot) && publicationPublished(other) {
			return true
		}
	}
	return false
}

// Materialize an independent platform receipt only when the user needs it.
// Content and media remain the exact confirmed snapshot; remote IDs never copy.
func (a *App) ensurePublicationPlatform(c *gin.Context) {
	var req struct {
		Platform string `json:"platform"`
		Revision int    `json:"revision"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Platform != "xhs" && req.Platform != "douyin" {
		fail(c, 400, "请选择小红书或抖音")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if !p.Ready || p.Revision != req.Revision {
		fail(c, 409, "发布稿未确认或已更新，请刷新后重试")
		return
	}
	if publicationPlatform(p) == req.Platform {
		c.JSON(200, p)
		return
	}
	all, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		bad(c, err)
		return
	}
	v := domain.Version{ProjectID: p.ProjectID, Content: p.Content, Media: &domain.VersionMedia{Kind: p.Kind, AssetIDs: p.AssetIDs, CoverID: p.CoverID}}
	for _, other := range all {
		if other.DeletedAt == "" && other.Ready && other.ProjectID == p.ProjectID && (other.VersionID == p.VersionID || (p.GroupID != "" && other.GroupID == p.GroupID)) && publicationPlatform(other) == req.Platform && samePublicationContent(other, v) && !publicationReplaced(other, all) {
			c.JSON(200, other)
			return
		}
	}
	if _, ok := a.editableProject(c, p.ProjectID); !ok {
		return
	}
	original, err := store.Get[domain.Version](a.Store.DB, "versions", p.VersionID)
	if err != nil || original.ProjectID != p.ProjectID || original.Status != "confirmed" || original.Media == nil || !samePublicationContent(p, original) {
		fail(c, 409, "发布稿与确认内容不一致，请返回项目重新准备")
		return
	}
	if req.Platform == "xhs" {
		if err := validateProjectTitle(domain.Project{Platform: "xhs"}, p.Title); err != nil {
			bad(c, err)
			return
		}
	}
	if err := a.requireCompleteVersion(v); err != nil {
		bad(c, err)
		return
	}
	when := Now()
	other := domain.Publication{
		ID: ID(), SharedDraftID: publicationDraftID(p), GroupID: p.GroupID,
		ProjectID: p.ProjectID, VersionID: p.VersionID,
		TargetPlatform: req.Platform, Content: p.Content, Kind: p.Kind,
		AssetIDs: append([]string{}, p.AssetIDs...), CoverID: p.CoverID,
		Ready: true, ManualStatus: "ready", Revision: 1, ConfirmedAt: p.ConfirmedAt,
		CreatedAt: when, UpdatedAt: when, ExportedAt: []string{},
	}
	if err := store.Put(a.Store.DB, "publications", other.ID, other); err != nil {
		bad(c, err)
		return
	}
	c.JSON(201, other)
}
