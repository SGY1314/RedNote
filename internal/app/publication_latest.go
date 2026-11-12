package app

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func samePublicationContent(p domain.Publication, v domain.Version) bool {
	return p.Title == v.Title && p.Body == v.Body && slices.Equal(p.Topics, v.Topics) && p.Kind == v.Media.Kind && p.CoverID == v.Media.CoverID && slices.Equal(p.AssetIDs, v.Media.AssetIDs)
}

func publicationPublished(p domain.Publication) bool {
	return p.PublishedAt != "" || p.RemoteWorkID != "" || p.OnlineState == "published" || p.ManualStatus == "published"
}
func publicationPlatform(p domain.Publication) string {
	if p.TargetPlatform == "" {
		return "xhs"
	}
	return p.TargetPlatform
}
func publicationReplaced(p domain.Publication, all []domain.Publication) bool {
	if publicationDraftPublished(p, all) {
		return false
	}
	if p.SharedDraftID != "" {
		for _, root := range all {
			if root.ID == p.SharedDraftID && root.SharedDraftID == "" {
				return root.DeletedAt != "" || publicationReplaced(root, all)
			}
		}
		return true
	}
	for _, latest := range all {
		if latest.ID != p.ID && latest.ProjectID == p.ProjectID && publicationPlatform(latest) == publicationPlatform(p) && latest.DeletedAt == "" && !publicationPublished(latest) && latest.WorkflowManaged && (!p.WorkflowManaged || latest.UpdatedAt > p.UpdatedAt) {
			return true
		}
	}
	return false
}

func (a *App) latestWorkflowPublications(project domain.Project, v domain.Version, target string) ([]domain.Publication, error) {
	all, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		return nil, err
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		return nil, err
	}
	targets := []string{target}
	if target == "both" {
		targets = []string{"xhs", "douyin"}
	}
	for _, old := range all {
		if old.ProjectID == project.ID && old.WorkflowManaged && old.SharedDraftID == "" && !publicationDraftPublished(old, all) && old.DeletedAt == "" && old.PublishedAt == "" && old.RemoteWorkID == "" && old.ManualStatus != "published" && !slices.Contains(targets, old.TargetPlatform) {
			targets = append(targets, old.TargetPlatform)
		}
	}
	group := ""
	if len(targets) > 1 {
		group = ID()
	}
	result := []domain.Publication{}
	for _, platform := range targets {
		var pub domain.Publication
		for _, old := range all {
			if old.ProjectID != project.ID || old.TargetPlatform != platform || old.SharedDraftID != "" || publicationDraftPublished(old, all) || old.DeletedAt != "" || old.PublishedAt != "" || old.RemoteWorkID != "" || old.OnlineState == "published" || old.ManualStatus == "published" {
				continue
			}
			if pub.ID == "" || (old.WorkflowManaged && !pub.WorkflowManaged) || (old.WorkflowManaged == pub.WorkflowManaged && old.CreatedAt > pub.CreatedAt) {
				pub = old
			}
		}
		fresh := pub.ID == ""
		if fresh {
			candidate := v.ID + "-" + platform
			for {
				exists := false
				for _, old := range all {
					if old.ID == candidate {
						exists = true
						break
					}
				}
				if !exists {
					break
				}
				candidate += "-next"
			}
			pub = domain.Publication{ID: candidate, ProjectID: project.ID, TargetPlatform: platform, CreatedAt: Now(), ExportedAt: []string{}}
		}
		changed := fresh || !pub.WorkflowManaged || !samePublicationContent(pub, v)
		if changed && !fresh {
			if err = a.publicationDeletionReady(pub, jobs); err != nil {
				return nil, err
			}
			if pub.OnlineState == "needs_review" || pub.OnlineState == "unknown" || pub.OnlineState == "manual_ready" || pub.OnlineState == "prepared" || pub.OnlineState == "manual_review" {
				return nil, errors.New("已有发布操作需要核实，请先在发布管理确认结果再更新内容")
			}
		}
		if changed {
			pub.Content, pub.Kind, pub.AssetIDs, pub.CoverID = v.Content, v.Media.Kind, append([]string{}, v.Media.AssetIDs...), v.Media.CoverID
			pub.Ready, pub.ConfirmedAt, pub.OnlineState, pub.OnlineJobID, pub.SubmittedAt = false, "", "", "", ""
			pub.ManualStatus = ""
			pub.Revision++
			pub.UpdatedAt = Now()
		}
		pub.VersionID, pub.WorkflowManaged = v.ID, true
		if group != "" && pub.GroupID == "" {
			pub.GroupID = group
		}
		result = append(result, pub)
	}
	return result, nil
}

type publicationEdits struct {
	Title    string   `json:"title"`
	Body     string   `json:"body"`
	Topics   []string `json:"topics"`
	AssetIDs []string `json:"asset_ids"`
	CoverID  string   `json:"cover_id"`
}
type publicationConfirmation struct {
	PreparedVersionID string            `json:"prepared_version_id,omitempty"`
	TargetPlatform    string            `json:"target_platform,omitempty"`
	Edit              *publicationEdits `json:"edit,omitempty"`
	ID                string            `json:"id"`
	Revision          int               `json:"revision"`
}

func (a *App) confirmPublication(c *gin.Context) {
	var req publicationConfirmation
	if !bind(c, &req) {
		return
	}
	req.ID = c.Param("id")
	a.confirmPublicationItems(c, []publicationConfirmation{req}, true)
}
func (a *App) confirmPublications(c *gin.Context) {
	var req struct {
		Items []publicationConfirmation `json:"items"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.Items) < 1 || len(req.Items) > 2 {
		fail(c, 400, "请选择需要确认的发布稿")
		return
	}
	a.confirmPublicationItems(c, req.Items, false)
}
func (a *App) confirmPublicationItems(c *gin.Context, items []publicationConfirmation, single bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	result := []domain.Publication{}
	pendingVersions := []domain.Version{}
	seen := map[string]bool{}
	for _, req := range items {
		if seen[req.ID] {
			fail(c, 400, "发布稿不能重复确认")
			return
		}
		seen[req.ID] = true
		var p domain.Publication
		if req.PreparedVersionID != "" {
			v, err := store.Get[domain.Version](a.Store.DB, "versions", req.PreparedVersionID)
			if err != nil {
				fail(c, 404, "内容版本不存在")
				return
			}
			project, ok := a.editableProject(c, v.ProjectID)
			if !ok {
				return
			}
			if req.TargetPlatform != "xhs" && req.TargetPlatform != "douyin" {
				fail(c, 400, "请选择发布平台")
				return
			}
			if v.Media == nil {
				fail(c, 400, "请先确认素材")
				return
			}
			proposals, err := a.latestWorkflowPublications(project, v, req.TargetPlatform)
			if err != nil {
				fail(c, 409, err.Error())
				return
			}
			for _, proposal := range proposals {
				if proposal.ID == req.ID && proposal.TargetPlatform == req.TargetPlatform {
					p = proposal
				}
			}
			if p.ID == "" {
				fail(c, 409, "发布内容已更新，请重新准备发布")
				return
			}
		} else {
			var ok bool
			p, ok = a.activePublication(c, req.ID)
			if !ok {
				return
			}
		}
		if p.Revision != req.Revision {
			fail(c, 409, "发布稿已更新，请重新核对最新内容后确认")
			return
		}
		if p.PublishedAt != "" || p.RemoteWorkID != "" || p.OnlineState == "published" || p.ManualStatus == "published" {
			fail(c, 409, "这份内容已有发布记录")
			return
		}
		if req.Edit != nil {
			edit := req.Edit
			if len([]rune(edit.Body)) > 12000 || len(edit.Topics) > 30 {
				fail(c, 400, "正文最多12000字，话题最多30个")
				return
			}
			for _, topic := range edit.Topics {
				if len([]rune(topic)) > 80 {
					fail(c, 400, "单个话题最多80字")
					return
				}
			}
			for _, id := range edit.AssetIDs {
				if !slices.Contains(p.AssetIDs, id) {
					fail(c, 400, "只能保留或移除这份发布稿已有的素材")
					return
				}
			}
			next := p
			next.Title, next.Body, next.Topics, next.AssetIDs = strings.TrimSpace(edit.Title), strings.TrimSpace(edit.Body), append([]string{}, edit.Topics...), append([]string{}, edit.AssetIDs...)
			if p.Kind == "image" && !slices.Contains(next.AssetIDs, next.CoverID) {
				next.CoverID = ""
				if len(next.AssetIDs) > 0 {
					next.CoverID = next.AssetIDs[0]
				}
			}
			changed := next.Title != p.Title || next.Body != p.Body || !slices.Equal(next.Topics, p.Topics) || !slices.Equal(next.AssetIDs, p.AssetIDs) || next.CoverID != p.CoverID
			if changed {
				jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
				if err != nil {
					bad(c, err)
					return
				}
				if err = a.publicationDeletionReady(p, jobs); err != nil {
					fail(c, 409, err.Error())
					return
				}
				if slices.Contains([]string{"needs_review", "unknown", "manual_ready", "prepared", "manual_review"}, p.OnlineState) {
					fail(c, 409, "请先核实已有发布操作，再编辑发布稿")
					return
				}
				next.Revision++
				next.UpdatedAt = Now()
				next.Ready = false
				next.ConfirmedAt = ""
				next.OnlineState, next.OnlineJobID, next.SubmittedAt = "", "", ""
				p = next
			}
		}
		project, ok := a.editableProject(c, p.ProjectID)
		if !ok {
			return
		}
		if p.TargetPlatform != "douyin" {
			if err := validateProjectTitle(domain.Project{Platform: "xhs"}, p.Title); err != nil {
				bad(c, err)
				return
			}
		}
		v := domain.Version{ProjectID: project.ID, Content: p.Content, Media: &domain.VersionMedia{Kind: p.Kind, AssetIDs: p.AssetIDs, CoverID: p.CoverID}}
		if err := a.requireCompleteVersion(v); err != nil {
			bad(c, err)
			return
		}
		if req.Edit != nil {
			original, err := store.Get[domain.Version](a.Store.DB, "versions", p.VersionID)
			if err != nil {
				bad(c, err)
				return
			}
			if !samePublicationContent(p, original) {
				all, err := store.List[domain.Version](a.Store.DB, "versions")
				if err != nil {
					bad(c, err)
					return
				}
				number := 1
				for _, old := range append(all, pendingVersions...) {
					if old.ProjectID == p.ProjectID && old.Number >= number {
						number = old.Number + 1
					}
				}
				edited := original
				edited.ID, edited.ParentID, edited.Number = ID(), original.ID, number
				edited.Name = fmt.Sprintf("发布稿编辑 V%d", number)
				edited.Content, edited.Media = p.Content, v.Media
				edited.CreatedAt, edited.ConfirmedAt, edited.Status = Now(), Now(), "confirmed"
				edited.GenerationRecords, err = a.snapshotGenerationRecords(edited.Media)
				if err != nil {
					bad(c, err)
					return
				}
				pendingVersions = append(pendingVersions, edited)
				p.VersionID = edited.ID
			}
		}
		if !p.Ready {
			p.Ready, p.ConfirmedAt = true, Now()
		}
		result = append(result, p)
	}
	// Archive old snapshots only after every item has passed validation.
	archived, err := a.preparePublicationReplacement(result)
	if err != nil {
		fail(c, 409, err.Error())
		return
	}
	if err := a.Store.Transaction(func(tx *sql.Tx) error {
		for _, old := range archived {
			if err := store.Put(tx, "publications", old.ID, old); err != nil {
				return err
			}
		}
		for _, version := range pendingVersions {
			if err := store.Put(tx, "versions", version.ID, version); err != nil {
				return err
			}
		}
		for _, p := range result {
			if err := store.Put(tx, "publications", p.ID, p); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		fail(c, 500, "确认发布稿失败")
		return
	}
	if single {
		c.JSON(200, result[0])
	} else {
		c.JSON(200, gin.H{"items": result})
	}
}

// Rebuild a review from immutable versions without persisting publications.
func (a *App) previewPublications(c *gin.Context) {
	var req struct {
		Items []publicationConfirmation `json:"items"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.Items) < 1 || len(req.Items) > 2 {
		fail(c, 400, "请选择需要核对的发布稿")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	result := []domain.Publication{}
	seen := map[string]bool{}
	for _, item := range req.Items {
		v, err := store.Get[domain.Version](a.Store.DB, "versions", item.PreparedVersionID)
		if err != nil {
			fail(c, 404, "内容版本不存在")
			return
		}
		project, ok := a.editableProject(c, v.ProjectID)
		if !ok {
			return
		}
		if item.TargetPlatform != "xhs" && item.TargetPlatform != "douyin" {
			fail(c, 400, "请选择发布平台")
			return
		}
		if v.Media == nil {
			fail(c, 400, "请先确认素材")
			return
		}
		if old, e := store.Get[domain.Publication](a.Store.DB, "publications", item.ID); e == nil {
			if old.ProjectID != project.ID || old.DeletedAt != "" {
				fail(c, 409, "发布稿已移除，请关闭后重新准备发布")
				return
			}
			if old.PublishedAt != "" || old.RemoteWorkID != "" || old.OnlineState == "published" || old.ManualStatus == "published" {
				fail(c, 409, "这份稿件已有发布记录，请关闭并检查发布管理")
				return
			}
		} else if !errors.Is(e, sql.ErrNoRows) {
			bad(c, e)
			return
		}
		proposals, err := a.latestWorkflowPublications(project, v, item.TargetPlatform)
		if err != nil {
			fail(c, 409, err.Error())
			return
		}
		for _, proposal := range proposals {
			if proposal.TargetPlatform != item.TargetPlatform {
				continue
			}
			if seen[proposal.ID] {
				fail(c, 400, "发布稿不能重复")
				return
			}
			seen[proposal.ID] = true
			result = append(result, proposal)
		}
	}
	c.JSON(200, gin.H{"items": result})
}

// Keep the review read-only. Allocate a new publication ID only at final commit,
// retaining the old content and version in the recycle bin.
func (a *App) preparePublicationReplacement(result []domain.Publication) ([]domain.Publication, error) {
	all, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		return nil, err
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		return nil, err
	}
	used, pairs := map[string]bool{}, map[string]bool{}
	for _, old := range all {
		used[old.ID] = true
	}
	for i := range result {
		p := &result[i]
		pair := p.ProjectID + ":" + publicationPlatform(*p)
		if pairs[pair] {
			return nil, errors.New("同一项目和平台只能确认一份当前发布稿")
		}
		pairs[pair] = true
		for _, old := range all {
			if old.ID != p.ID {
				continue
			}
			version := domain.Version{Content: p.Content, Media: &domain.VersionMedia{Kind: p.Kind, AssetIDs: p.AssetIDs, CoverID: p.CoverID}}
			if old.VersionID != p.VersionID || !samePublicationContent(old, version) {
				id := p.VersionID + "-" + publicationPlatform(*p)
				for used[id] {
					id += "-next"
				}
				p.ID, p.CreatedAt = id, Now()
				p.SharedDraftID = ""
				p.UpdatedAt, p.ConfirmedAt = p.CreatedAt, p.CreatedAt
				if p.Revision <= old.Revision {
					p.Revision = old.Revision + 1
				}
				used[id] = true
			}
			break
		}
	}
	archived := []domain.Publication{}
	for _, old := range all {
		if old.DeletedAt != "" || publicationDraftPublished(old, all) {
			continue
		}
		for _, p := range result {
			if old.ID == p.ID || old.ProjectID != p.ProjectID || publicationPlatform(old) != publicationPlatform(p) {
				continue
			}
			if err := a.publicationDeletionReady(old, jobs); err != nil {
				return nil, err
			}
			if slices.Contains([]string{"needs_review", "unknown", "manual_ready", "prepared", "manual_review"}, old.OnlineState) {
				return nil, errors.New("旧发布稿的发布结果需要核实，请先处理后再确认新稿")
			}
			old.DeletedAt, old.UpdatedAt = Now(), Now()
			old.Revision++
			archived = append(archived, old)
			break
		}
	}
	// Keep unposted companions in the same recycle-bin transaction as their root.
	for _, old := range all {
		if old.SharedDraftID == "" || old.DeletedAt != "" || publicationDraftPublished(old, all) {
			continue
		}
		already, rootArchived := false, false
		for _, item := range archived {
			already = already || item.ID == old.ID
			rootArchived = rootArchived || item.ID == old.SharedDraftID
		}
		if already || !rootArchived {
			continue
		}
		if err := a.publicationDeletionReady(old, jobs); err != nil {
			return nil, err
		}
		if slices.Contains([]string{"needs_review", "unknown", "manual_ready", "prepared", "manual_review"}, old.OnlineState) {
			return nil, errors.New("旧发布稿的发布结果需要核实，请先处理后再确认新稿")
		}
		old.DeletedAt, old.UpdatedAt = Now(), Now()
		old.Revision++
		archived = append(archived, old)
	}
	return archived, nil
}
