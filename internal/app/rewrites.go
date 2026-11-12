package app

import (
	"database/sql"
	"fmt"
	"github.com/gin-gonic/gin"
	"slices"
	"strings"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) createProject(c *gin.Context) {
	var req struct {
		Name     string `json:"name"`
		NoteID   string `json:"note_id"`
		Platform string `json:"platform"`
		Kind     string `json:"kind"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Kind != "" && req.Kind != "image" && req.Kind != "video" {
		fail(c, 400, "请选择仿写图片或仿写视频")
		return
	}
	if req.Platform != "" && req.Platform != "xhs" && req.Platform != "douyin" {
		fail(c, 400, "请选择小红书或抖音")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p := domain.Project{ID: ID(), Name: strings.TrimSpace(req.Name), NoteID: req.NoteID, Sources: []domain.Source{}, CreatedAt: Now()}
	p.Platform = req.Platform
	if p.Platform == "" {
		p.Platform = "xhs"
	}
	if req.NoteID != "" {
		n, ok := get[domain.Note](a, c, "notes", req.NoteID)
		if !ok {
			return
		}
		if req.Platform != "" && req.Platform != n.Platform {
			fail(c, 400, "来源笔记不属于当前平台，请切换平台后创建")
			return
		}
		// Check under the creation lock so retries and concurrent tabs reuse one
		// active project, regardless of requested format or refreshed note revision.
		projects, err := store.List[domain.Project](a.Store.DB, "projects")
		if err != nil {
			fail(c, 500, "检查已有仿写项目失败，请重试")
			return
		}
		for _, existing := range projects {
			if existing.NoteID == n.ID && existing.DeletedAt == "" {
				ensureMediaSelections(&existing)
				c.JSON(200, struct {
					domain.Project
					Reused bool `json:"reused"`
				}{Project: existing, Reused: true})
				return
			}
		}
		p.Platform = n.Platform
		rev, ok := get[domain.Revision](a, c, "revisions", n.RevisionID)
		if !ok {
			return
		}
		p.RevisionID = rev.ID
		p.Kind = rev.Kind
		if p.Name == "" {
			p.Name = rev.Title
		}
		p.Sources = append(p.Sources, domain.Source{ID: "original", Label: "原始笔记", Text: rev.Title + "\n" + rev.Body + "\n" + strings.Join(rev.Topics, " ")})
		exs, _ := store.List[domain.Extraction](a.Store.DB, "extractions")
		for _, aid := range rev.AssetIDs {
			for _, ex := range exs {
				if ex.AssetID == aid {
					label := "图片 OCR"
					if ex.Kind == "asr" {
						label = "原视频转写"
					}
					p.Sources = append(p.Sources, domain.Source{ID: ex.ID, Label: fmt.Sprintf("%s · %d", label, len(p.Sources)), Text: ex.Text})
					break // Latest extraction only; older machine/manual results remain in history.
				}
			}
		}
	}
	if p.Name == "" {
		p.Name = "未命名创作"
	}
	if req.Kind != "" {
		p.Kind = req.Kind
	}
	ensureMediaSelections(&p)
	if e := store.Put(a.Store.DB, "projects", p.ID, p); e != nil {
		fail(c, 500, "创建失败")
		return
	}
	c.JSON(201, p)
}
func (a *App) projectDetail(c *gin.Context) {
	p, ok := get[domain.Project](a, c, "projects", c.Param("id"))
	if !ok {
		return
	}
	ensureMediaSelections(&p)
	all, _ := store.List[domain.Version](a.Store.DB, "versions")
	vs := []domain.Version{}
	for _, v := range all {
		if v.ProjectID == p.ID {
			vs = append(vs, v)
		}
	}
	images := []domain.Asset{}
	videos := []domain.Asset{}
	if p.RevisionID != "" {
		rev, err := store.Get[domain.Revision](a.Store.DB, "revisions", p.RevisionID)
		if err != nil {
			fail(c, 500, "读取参考图片快照失败")
			return
		}
		for _, id := range rev.AssetIDs {
			v, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
			if err == nil && v.Kind == "image" {
				images = append(images, v)
			}
			if err == nil && v.Kind == "video" {
				videos = append(videos, v)
			}
		}
	}
	if names, err := assetPresentations(a.Store.DB); err == nil {
		for i := range images {
			if v, ok := names[images[i].ID]; ok {
				images[i] = v
			}
		}
		for i := range videos {
			if v, ok := names[videos[i].ID]; ok {
				videos[i] = v
			}
		}
	}
	c.JSON(200, gin.H{"project": p, "versions": vs, "reference_assets": images, "reference_videos": videos})
}
func (a *App) saveVersion(c *gin.Context) {
	var req struct {
		Creative *domain.CreativeSettings `json:"creative"`
		Name     string                   `json:"name"`
		Media    *domain.VersionMedia     `json:"media"`
		ParentID string                   `json:"parent_id"`
		domain.Content
		SourceIDs    []string `json:"source_ids"`
		Instructions string   `json:"instructions"`
	}
	if !bind(c, &req) {
		return
	}
	if err := validateCreative(req.Creative); err != nil {
		bad(c, err)
		return
	}
	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Body) == "" {
		fail(c, 400, "请填写标题和正文")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if len([]rune(strings.TrimSpace(req.Name))) > 80 {
		fail(c, 400, "版本名称最多 80 字")
		return
	}
	v := domain.Version{Name: strings.TrimSpace(req.Name), ID: ID(), ProjectID: p.ID, Content: req.Content, SourceIDs: req.SourceIDs, Instructions: req.Instructions, Status: "draft", CreatedAt: Now()}
	if err := validateProjectTitle(p, v.Title); err != nil {
		bad(c, err)
		return
	}
	v.Creative = req.Creative
	v.SourceSnapshot = selectedSources(p.Sources, req.SourceIDs)
	v.Media = versionMedia(p)
	if req.Media != nil {
		v.Media = req.Media
	}
	if err := a.validateVersionMedia(v.Media); err != nil {
		bad(c, err)
		return
	}
	if req.ParentID != "" {
		parent, err := store.Get[domain.Version](a.Store.DB, "versions", req.ParentID)
		if err != nil || parent.ProjectID != p.ID {
			fail(c, 400, "来源版本不属于当前项目")
			return
		}
		v.ParentID = parent.ID
		v.Hook = parent.Hook
		v.Model, v.ModelName = parent.Model, parent.ModelName
		if req.Creative == nil {
			v.Creative = parent.Creative
		}
	}
	ensureMediaSelections(&p)
	p.Kind, p.AssetIDs, p.CoverID = v.Media.Kind, append([]string{}, v.Media.AssetIDs...), v.Media.CoverID
	p.MediaSelections[p.Kind] = domain.MediaSelection{AssetIDs: append([]string{}, p.AssetIDs...), CoverID: p.CoverID}
	all, err := store.List[domain.Version](a.Store.DB, "versions")
	if err != nil {
		fail(c, 500, "检查已有版本失败")
		return
	}
	for _, old := range all {
		if old.ProjectID == p.ID && !old.Generated && sameVersionContent(old, v) {
			if v.Name != "" {
				old.Name = v.Name
			}
			err = a.Store.Transaction(func(tx *sql.Tx) error {
				if e := store.Put(tx, "projects", p.ID, p); e != nil {
					return e
				}
				return store.Put(tx, "versions", old.ID, old)
			})
			if err != nil {
				fail(c, 500, "保存版本失败")
				return
			}
			c.JSON(200, struct {
				domain.Version
				Reused bool `json:"reused"`
			}{old, true})
			return
		}
	}
	e := a.persistVersion(&v, p)
	if e != nil {
		fail(c, 500, "保存版本失败")
		return
	}
	if v.Number == 1 && p.NoteID == "" {
		p.Name = v.Title
		store.Put(a.Store.DB, "projects", p.ID, p)
	}
	c.JSON(201, v)
}
func (a *App) persistVersion(v *domain.Version, draft ...domain.Project) error {
	records, err := a.snapshotGenerationRecords(v.Media)
	if err != nil {
		return err
	}
	v.GenerationRecords = records
	all, e := store.List[domain.Version](a.Store.DB, "versions")
	if e != nil {
		return e
	}
	v.Number = 1
	for _, old := range all {
		if old.ProjectID == v.ProjectID && !old.Generated && old.Number >= v.Number {
			v.Number = old.Number + 1
		}
	}
	if v.Generated {
		v.Number = 0
	}
	return a.Store.Transaction(func(tx *sql.Tx) error {
		if err := store.Put(tx, "versions", v.ID, v); err != nil {
			return err
		}
		if len(draft) > 0 {
			return store.Put(tx, "projects", draft[0].ID, draft[0])
		}
		return nil
	})
}
func (a *App) confirmVersion(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	v, ok := get[domain.Version](a, c, "versions", c.Param("vid"))
	if !ok {
		return
	}
	if v.ProjectID != c.Param("id") {
		fail(c, 404, "版本不属于该项目")
		return
	}
	if v.Generated {
		fail(c, 409, "这是试写记录，请选好文案和素材后保存完整版本")
		return
	}
	v.Status = "confirmed"
	if v.Media == nil {
		fail(c, 409, "此历史版本仅保存文案，请选好图片后保存并确认新的整体版本")
		return
	}
	if err := a.validateVersionMedia(v.Media); err != nil {
		bad(c, err)
		return
	}
	if err := a.requireCompleteVersion(v); err != nil {
		bad(c, err)
		return
	}
	if v.ConfirmedAt == "" {
		v.ConfirmedAt = Now()
	}
	if p.SelectedVersions == nil {
		p.SelectedVersions = map[string]string{}
	}
	p.SelectedVersions[v.Media.Kind] = v.ID
	if e := a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "versions", v.ID, v); e != nil {
			return e
		}
		return store.Put(tx, "projects", p.ID, p)
	}); e != nil {
		fail(c, 500, "确认失败")
		return
	}
	c.JSON(200, v)
}
func (a *App) generate(c *gin.Context) {
	kind := "rewrite"
	if c.GetBool("suggest_angles") {
		kind = "angle_suggest"
	}
	var req struct {
		Creative     *domain.CreativeSettings `json:"creative"`
		CopyText     string                   `json:"copy_text"`
		Hook         string                   `json:"hook"`
		Media        *domain.VersionMedia     `json:"media"`
		ModelID      string                   `json:"model_id"`
		SourceIDs    []string                 `json:"source_ids"`
		Audience     string                   `json:"audience"`
		Tone         string                   `json:"tone"`
		Length       string                   `json:"length"`
		Requirements string                   `json:"requirements"`
	}
	if !bind(c, &req) {
		return
	}
	if err := validateCreative(req.Creative); err != nil {
		bad(c, err)
		return
	}
	if len([]rune(req.CopyText)) > 12000 {
		fail(c, 400, "当前文案最多 12000 字")
		return
	}
	hook, hookInstructions, hookErr := rewriteHookInstruction(req.Hook)
	if hookErr != nil {
		bad(c, hookErr)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if _, err := store.Get[creationWorkflow](a.Store.DB, "creation_workflows", p.ID); err == nil && kind == "rewrite" {
		fail(c, 409, "请分别使用标题仿写和文案仿写步骤")
		return
	}
	source := ""
	for _, s := range p.Sources {
		for _, id := range req.SourceIDs {
			if s.ID == id && strings.TrimSpace(s.Text) != "" {
				source += "\n【" + s.Label + "】\n" + s.Text
				break
			}
		}
	}
	if kind == "angle_suggest" && strings.TrimSpace(req.CopyText) != "" {
		source += "\n【用户当前文案（含尚未保存的编辑）】\n" + strings.TrimSpace(req.CopyText)
	}
	if strings.TrimSpace(source) == "" && strings.TrimSpace(req.Requirements) == "" && (req.Creative == nil || (strings.TrimSpace(req.Creative.Angle) == "" && strings.TrimSpace(req.Creative.Topic) == "")) {
		if kind == "angle_suggest" {
			fail(c, 400, "请填写主题或文案，也可以填写创作要求或勾选有文字的参考内容，再生成角度建议")
			return
		}
		fail(c, 400, "请选择参考内容，或填写创作要求")
		return
	}
	instructions := fmt.Sprintf("目标读者：%s\n语气：%s\n长度：%s\n补充要求：%s", req.Audience, req.Tone, req.Length, req.Requirements)
	if kind == "angle_suggest" {
		instructions = fmt.Sprintf("目标读者（供参考）：%s\n用户补充要求：%s", req.Audience, req.Requirements)
		if req.Creative != nil && strings.TrimSpace(req.Creative.Topic) != "" {
			instructions += "\n本次创作主题（围绕此主题找切入点）：" + req.Creative.Topic
		}
		if req.Creative != nil && strings.TrimSpace(req.Creative.Angle) != "" {
			instructions += "\n用户已有想法（可据此拓展）：" + req.Creative.Angle
		}
	} else {
		instructions += creativePrompt(req.Creative, "text")
	}
	// Angle suggestions have their own output contract; copywriting rules apply to actual posts.
	if kind == "rewrite" {
		instructions += "\n" + hookInstructions
	}
	if req.ModelID == "" {
		req.ModelID = "default"
	}
	models, e := a.rewriteModels()
	if e != nil {
		fail(c, 500, "读取模型配置失败")
		return
	}
	var model *rewriteModel
	for i := range models {
		if models[i].ID == req.ModelID {
			model = &models[i]
			break
		}
	}
	if model == nil {
		fail(c, 400, "请选择有效的文案模型")
		return
	}
	if model.Secret == "" {
		fail(c, 400, "所选模型待配置，请在仿写库中填写 API 密钥")
		return
	}
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		fail(c, 500, "读取任务失败")
		return
	}
	for _, old := range jobs {
		if old.Kind == kind && old.Target == p.ID && (old.State == "queued" || old.State == "running") {
			fail(c, 409, "当前项目正在生成，请完成后再选择其他模型生成新版本")
			return
		}
	}
	j := newJob(kind, p.ID, map[string]any{"source": source, "source_ids": req.SourceIDs, "instructions": instructions, "model_id": model.ID, "model": model.Model, "model_name": model.Name})
	j.Payload["creative"] = req.Creative
	j.Payload["platform"] = p.Platform
	j.Payload["hook"] = hook
	j.Payload["source_snapshot"] = selectedSources(p.Sources, req.SourceIDs)
	j.Payload["media"] = versionMedia(p)
	if req.Media != nil {
		j.Payload["media"] = req.Media
	}
	if err := a.validateVersionMedia(j.Payload["media"].(*domain.VersionMedia)); err != nil {
		bad(c, err)
		return
	}
	if kind == "rewrite" && j.Payload["media"].(*domain.VersionMedia).Kind == "video" {
		j.Payload["instructions"] = instructions + "\n创作类型：视频仿写。title 写作品标题，body 写可直接口播的视频文案，topics 写发布话题；参考原视频转写（若有），保持自然口语，不声称已生成视频画面。"
	}
	e = a.Store.Transaction(func(tx *sql.Tx) error {
		if err := store.Put(tx, "settings", "rewrite-job-"+j.ID, model.Service); err != nil {
			return err
		}
		return store.Put(tx, "jobs", j.ID, j)
	})
	if e != nil {
		fail(c, 500, "创建任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}
func (a *App) createPublication(c *gin.Context) {
	var req struct {
		RequestID      string   `json:"request_id"`
		TargetPlatform string   `json:"target_platform"`
		VersionID      string   `json:"version_id"`
		Kind           string   `json:"kind"`
		AssetIDs       []string `json:"asset_ids"`
		CoverID        *string  `json:"cover_id"`
	}
	if !bind(c, &req) {
		return
	}
	if req.TargetPlatform == "" {
		req.TargetPlatform = "xhs"
	}
	targets := []string{req.TargetPlatform}
	if req.TargetPlatform == "both" {
		targets = []string{"xhs", "douyin"}
	}
	if req.TargetPlatform != "xhs" && req.TargetPlatform != "douyin" && req.TargetPlatform != "both" {
		fail(c, 400, "不支持的目标平台")
		return
	}
	if len(req.RequestID) > 128 || (req.TargetPlatform == "both" && req.RequestID == "") {
		fail(c, 400, "创建请求标识无效，请刷新后重试")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	respond := func(status int, items []domain.Publication) {
		if req.TargetPlatform == "both" {
			c.JSON(status, gin.H{"items": items, "group_id": items[0].GroupID})
		} else {
			c.JSON(status, items[0])
		}
	}
	// Reuse the original snapshots after a lost response, even when one platform
	// has already published. Never recreate or reset a successful platform.
	if req.RequestID != "" {
		all, err := store.List[domain.Publication](a.Store.DB, "publications")
		if err != nil {
			fail(c, 500, "读取发布稿失败")
			return
		}
		previous := []domain.Publication{}
		for _, p := range all {
			if p.CreationID == req.RequestID {
				if p.DeletedAt != "" {
					fail(c, 409, "此请求对应的发布稿已在回收站，请先恢复")
					return
				}
				if p.VersionID != req.VersionID || !slices.Contains(targets, p.TargetPlatform) || (req.Kind != "" && req.Kind != p.Kind) || (req.AssetIDs != nil && !slices.Equal(req.AssetIDs, p.AssetIDs)) || (req.CoverID != nil && *req.CoverID != p.CoverID) {
					fail(c, 409, "此请求已用于其他发布稿，请重新选择版本或目标平台")
					return
				}
				previous = append(previous, p)
			}
		}
		if len(previous) > 0 {
			if len(previous) != len(targets) {
				fail(c, 409, "此请求的平台选择已变化，请重新建立发布稿")
				return
			}
			slices.SortFunc(previous, func(a, b domain.Publication) int {
				return slices.Index(targets, a.TargetPlatform) - slices.Index(targets, b.TargetPlatform)
			})
			respond(200, previous)
			return
		}
	}
	v, ok := get[domain.Version](a, c, "versions", req.VersionID)
	if !ok {
		return
	}
	if _, ok := a.editableProject(c, v.ProjectID); !ok {
		return
	}
	if slices.Contains(targets, "xhs") {
		if err := validateProjectTitle(domain.Project{Platform: "xhs"}, v.Title); err != nil {
			bad(c, err)
			return
		}
	}
	if v.Status != "confirmed" {
		fail(c, 409, "请先确认包含文案和素材的整体版本")
		return
	}
	if v.Media == nil {
		fail(c, 409, "此历史版本未记录素材，请保存并确认新的整体版本后发布")
		return
	}
	if err := a.requireCompleteVersion(v); err != nil {
		bad(c, err)
		return
	}
	if (req.Kind != "" && req.Kind != v.Media.Kind) || (req.AssetIDs != nil && !slices.Equal(req.AssetIDs, v.Media.AssetIDs)) || (req.CoverID != nil && *req.CoverID != v.Media.CoverID) {
		fail(c, 409, "发布素材与确认版本不一致，请将修改保存为新版本并确认后发布")
		return
	}
	req.Kind = v.Media.Kind
	req.AssetIDs = append([]string{}, v.Media.AssetIDs...)
	coverID := v.Media.CoverID
	if req.Kind != "image" && req.Kind != "video" {
		fail(c, 400, "请选择图文或视频")
		return
	}
	seen := map[string]bool{}
	for _, id := range req.AssetIDs {
		if seen[id] {
			fail(c, 400, "素材不能重复")
			return
		}
		seen[id] = true
		asset, ok := get[domain.Asset](a, c, "assets", id)
		if !ok {
			return
		}
		if asset.Status != "ready" || asset.Kind != req.Kind {
			fail(c, 400, "所选素材尚未就绪或类型不匹配")
			return
		}
	}
	if req.Kind == "video" && len(req.AssetIDs) > 1 {
		fail(c, 400, "视频稿只能选择一个视频")
		return
	}
	if coverID != "" {
		cover, ok := get[domain.Asset](a, c, "assets", coverID)
		if !ok {
			return
		}
		if cover.Kind != "image" || cover.Status != "ready" {
			fail(c, 400, "封面必须是可用图片")
			return
		}
	}
	if workflow, e := a.readWorkflow(v.ProjectID); e == nil && len(workflow.StageVersions) > 0 {
		var latest domain.Version
		for _, id := range workflow.StageVersions {
			if candidate, err := store.Get[domain.Version](a.Store.DB, "versions", id); err == nil && candidate.Number > latest.Number {
				latest = candidate
			}
		}
		if latest.ID != v.ID {
			fail(c, 409, "已有更新的保存内容，请使用当前项目的最新发布稿")
			return
		}
		project, _ := store.Get[domain.Project](a.Store.DB, "projects", v.ProjectID)
		items, err := a.latestWorkflowPublications(project, v, req.TargetPlatform)
		if err != nil {
			fail(c, 409, err.Error())
			return
		}
		if err = a.Store.Transaction(func(tx *sql.Tx) error {
			for _, item := range items {
				if err := store.Put(tx, "publications", item.ID, item); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			fail(c, 500, "保存发布稿失败")
			return
		}
		selected := []domain.Publication{}
		for _, item := range items {
			if slices.Contains(targets, item.TargetPlatform) {
				selected = append(selected, item)
			}
		}
		respond(200, selected)
		return
	}
	groupID := ""
	if len(targets) > 1 {
		groupID = ID()
	}
	items := []domain.Publication{}
	for _, target := range targets {
		p := domain.Publication{GroupID: groupID, CreationID: req.RequestID, TargetPlatform: target, ID: ID(), ProjectID: v.ProjectID, VersionID: v.ID, Content: v.Content, Kind: req.Kind, AssetIDs: append([]string{}, req.AssetIDs...), CoverID: coverID, Ready: len(req.AssetIDs) > 0, ExportedAt: []string{}, CreatedAt: Now()}
		items = append(items, p)
	}
	if e := a.Store.Transaction(func(tx *sql.Tx) error {
		for _, p := range items {
			if err := store.Put(tx, "publications", p.ID, p); err != nil {
				return err
			}
		}
		return nil
	}); e != nil {
		fail(c, 500, "创建发布稿失败")
		return
	}
	respond(201, items)
}
