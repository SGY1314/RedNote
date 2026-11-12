package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type workflowStageRequest struct {
	UseProjectVideoResults bool                 `json:"use_project_video_results"`
	UseProjectImageResults bool                 `json:"use_project_image_results"`
	Step                   string               `json:"step"`
	Text                   string               `json:"text"`
	Topics                 []string             `json:"topics"`
	GenerationID           string               `json:"generation_id"`
	TitleKey               string               `json:"title_key"`
	CopyKey                string               `json:"copy_key"`
	Media                  *domain.VersionMedia `json:"media"`
	Publish                bool                 `json:"publish"`
	TargetPlatform         string               `json:"target_platform"`
}

var errWorkflowStageStale = errors.New("上游内容已变化")

func (a *App) workflowOriginalMedia(rev domain.Revision) (*domain.VersionMedia, error) {
	rows, err := a.Store.DB.Query("SELECT data FROM assets WHERE json_extract(data,'$.revision_id')=? ORDER BY COALESCE(json_extract(data,'$.position'),0),rowid", rev.ID)
	if err != nil {
		return nil, err
	}
	assets, ids := map[string]domain.Asset{}, append([]string{}, rev.AssetIDs...)
	for rows.Next() {
		var raw string
		var asset domain.Asset
		if err = rows.Scan(&raw); err == nil {
			err = json.Unmarshal([]byte(raw), &asset)
		}
		if err != nil {
			rows.Close()
			return nil, err
		}
		assets[asset.ID] = asset
		if !slices.Contains(ids, asset.ID) {
			ids = append(ids, asset.ID)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if _, ok := assets[id]; !ok {
			if asset, err := store.Get[domain.Asset](a.Store.DB, "assets", id); err == nil {
				assets[id] = asset
			}
		}
	}
	kind := rev.Kind
	if kind == "" {
		kind = "image"
		for _, asset := range assets {
			if asset.Kind == "video" {
				kind = "video"
			}
		}
	}
	media := &domain.VersionMedia{Kind: kind, AssetIDs: []string{}}
	for _, id := range ids {
		asset, exists := assets[id]
		if (exists && asset.Kind == kind) || (!exists && kind == "image") {
			if !slices.Contains(media.AssetIDs, id) {
				media.AssetIDs = append(media.AssetIDs, id)
			}
		}
		if asset.Kind == "image" && media.CoverID == "" {
			media.CoverID = id
		}
	}
	return media, nil
}

func (a *App) applyWorkflowStage(p domain.Project, rev domain.Revision, w *creationWorkflow, req workflowStageRequest) (domain.Content, error) {
	content := domain.Content{Title: rev.Title, Body: rev.Body, Topics: append([]string{}, rev.Topics...)}
	basis := workflowBasisFor(p, *w, rev)
	titleMatches := req.TitleKey == basis.Title.Key || (req.TitleKey == "" && w.Title.Key == "")
	text := strings.TrimSpace(req.Text)
	if req.Step == "title" {
		if !titleMatches && w.Title.Text != text {
			return content, fmt.Errorf("%w，请重新检查当前标题", errWorkflowStageStale)
		}
		if err := validateProjectTitle(p, text); err != nil {
			return content, err
		}
		if req.GenerationID != "" {
			g, err := store.Get[textGeneration](a.Store.DB, "title_generations", req.GenerationID)
			if err != nil || g.ProjectID != p.ID {
				return content, errors.New("标题生成记录不属于当前项目")
			}
		}
		if w.Title.Key == "" || w.Title.Text != text {
			w.Title = workflowTitle{Key: ID(), Text: text, GenerationID: req.GenerationID, ConfirmedAt: Now()}
		}
		content.Title = text
		content.Body, content.Topics = basis.Copy.Body, append([]string{}, basis.Copy.Topics...)
		return content, nil
	}
	if !titleMatches {
		return content, fmt.Errorf("%w，请重新检查当前标题和内容", errWorkflowStageStale)
	}
	content.Title = basis.Title.Text
	if req.Step == "copy" {
		copyMatches := req.CopyKey == basis.Copy.Key || (req.CopyKey == "" && w.Copy.Key == "")
		if !copyMatches && (w.Copy.Body != text || !slices.Equal(w.Copy.Topics, req.Topics)) {
			return content, fmt.Errorf("%w，请重新检查当前文案", errWorkflowStageStale)
		}
		if text == "" || len([]rune(text)) > 12000 || len(req.Topics) > 30 {
			return content, errors.New("请填写完整正文（最多12000字，话题最多30个）")
		}
		for _, topic := range req.Topics {
			if len([]rune(topic)) > 80 {
				return content, errors.New("单个话题最多80字")
			}
		}
		if req.GenerationID != "" {
			g, err := store.Get[textGeneration](a.Store.DB, "copy_generations", req.GenerationID)
			if err != nil || g.ProjectID != p.ID || g.TitleKey != basis.Title.Key {
				return content, errors.New("文案生成记录与当前标题不匹配")
			}
		}
		if w.Copy.Key == "" || w.Copy.TitleKey != basis.Title.Key || w.Copy.Body != text || !slices.Equal(w.Copy.Topics, req.Topics) {
			w.Copy = workflowCopy{Key: ID(), TitleKey: basis.Title.Key, Body: text, Topics: append([]string{}, req.Topics...), GenerationID: req.GenerationID, ConfirmedAt: Now()}
		}
		basis.Copy = w.Copy
	} else if req.CopyKey != basis.Copy.Key {
		return content, fmt.Errorf("%w，请重新检查当前文案和素材", errWorkflowStageStale)
	}
	content.Body, content.Topics = basis.Copy.Body, append([]string{}, basis.Copy.Topics...)
	return content, nil
}

// Confirmations update the current stage draft; publication snapshots remain immutable.
func (a *App) saveWorkflowStage(c *gin.Context) {
	var req workflowStageRequest
	if !bind(c, &req) {
		return
	}
	if !slices.Contains([]string{"title", "copy", "image", "video"}, req.Step) {
		fail(c, 400, "请选择标题、文案、图片或视频环节")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	rev, err := a.workflowReference(&p)
	if err != nil {
		bad(c, err)
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	content, err := a.applyWorkflowStage(p, rev, &w, req)
	if err != nil {
		if errors.Is(err, errWorkflowStageStale) {
			fail(c, 409, err.Error())
			return
		}
		bad(c, err)
		return
	}
	media, err := a.workflowOriginalMedia(rev)
	if err != nil {
		bad(c, err)
		return
	}
	if w.Media != nil {
		media = w.Media
	} else {
		// Recover the latest saved media for workflows created before saved_media.
		var latest domain.Version
		for _, step := range []string{"image", "video"} {
			if old, e := store.Get[domain.Version](a.Store.DB, "versions", w.StageVersions[step]); e == nil && old.Media != nil && old.Number > latest.Number {
				latest = old
			}
		}
		if latest.Media != nil {
			media = latest.Media
		}
	}
	if req.Step == "image" || req.Step == "video" {
		if req.Media == nil || req.Media.Kind != req.Step {
			fail(c, 400, "请选择当前环节的发布素材")
			return
		}
		media = req.Media
		if req.Step == "image" && req.UseProjectImageResults {
			err = a.validateProjectImageResults(p, media)
		} else if req.Step == "video" && req.UseProjectVideoResults {
			err = a.validateProjectVideoResults(p, media)
		} else {
			err = a.validateWorkflowMediaSelection(p, w, req.Step, media.AssetIDs)
		}
		if err != nil {
			if errors.Is(err, errWorkflowStageStale) {
				fail(c, 409, err.Error())
			} else {
				bad(c, err)
			}
			return
		}
		w.Media = &domain.VersionMedia{Kind: media.Kind, AssetIDs: append([]string{}, media.AssetIDs...), CoverID: media.CoverID}
	}
	basis := workflowBasisFor(p, w, rev)
	v := domain.Version{ID: ID(), ProjectID: p.ID, Content: content, Media: media, Status: "draft", CreatedAt: Now(), SourceIDs: []string{"original"}, SourceSnapshot: p.Sources, WorkflowSnapshot: map[string]string{"stage": req.Step, "reference_revision_id": rev.ID, "title_key": basis.Title.Key, "copy_key": basis.Copy.Key, "account_profile_key": w.AccountProfile.Key}}
	completeErr := a.requireCompleteVersion(v)
	if completeErr == nil {
		v.Status, v.ConfirmedAt = "confirmed", Now()
		v.GenerationRecords, err = a.snapshotGenerationRecords(v.Media)
		if err != nil {
			bad(c, err)
			return
		}
	}
	if req.TargetPlatform == "" {
		req.TargetPlatform = p.Platform
		if req.TargetPlatform == "" {
			req.TargetPlatform = "xhs"
		}
	}
	if !slices.Contains([]string{"xhs", "douyin", "both"}, req.TargetPlatform) {
		fail(c, 400, "不支持的发布平台")
		return
	}
	if req.TargetPlatform != "douyin" && strings.TrimSpace(v.Title) != "" {
		if err = validateProjectTitle(domain.Project{Platform: "xhs"}, v.Title); err != nil {
			bad(c, err)
			return
		}
	}
	all, err := store.List[domain.Version](a.Store.DB, "versions")
	if err != nil {
		bad(c, err)
		return
	}
	publicationsForVersion, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		bad(c, err)
		return
	}
	frozen := map[string]bool{}
	for _, pub := range publicationsForVersion {
		frozen[pub.VersionID] = true
	}
	v.Number = 1
	reused := false
	for _, old := range all {
		if old.ProjectID != p.ID || old.Generated {
			continue
		}
		if old.Number >= v.Number {
			v.Number = old.Number + 1
		}
	}
	for _, old := range all {
		if old.ID != w.StageVersions[req.Step] || old.ProjectID != p.ID || old.Generated {
			continue
		}
		same := old.WorkflowSnapshot["reference_revision_id"] == rev.ID && old.WorkflowSnapshot["account_profile_key"] == w.AccountProfile.Key && sameVersionContent(old, v)
		if same || !frozen[old.ID] {
			v.ID, v.Number, v.CreatedAt = old.ID, old.Number, old.CreatedAt
			reused = same
		}
		break
	}
	v.Name = map[string]string{"title": "当前标题", "copy": "当前文案", "image": "当前图片", "video": "当前视频"}[req.Step]
	if w.StageVersions == nil {
		w.StageVersions = map[string]string{}
	}
	w.StageVersions[req.Step], w.UpdatedAt = v.ID, Now()
	publications := []domain.Publication{}
	if req.Publish {
		publications, err = a.latestWorkflowPublications(p, v, req.TargetPlatform)
		if err != nil {
			fail(c, 409, err.Error())
			return
		}
	}
	if err = a.syncConfirmedReferences(&w, rev, req.Step, content); err != nil {
		bad(c, err)
		return
	}
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		if err := store.Put(tx, "creation_workflows", p.ID, w); err != nil {
			return err
		}
		if err := store.Put(tx, "versions", v.ID, v); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		bad(c, err)
		return
	}
	status := 201
	if reused {
		status = 200
	}
	c.JSON(status, gin.H{"workflow": w, "version": v, "publications": publications})
}
