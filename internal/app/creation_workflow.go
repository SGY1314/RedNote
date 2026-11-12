package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"slices"
	"strings"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type workflowDraft struct {
	Revision int             `json:"revision"`
	Data     json.RawMessage `json:"data"`
	SavedAt  string          `json:"saved_at"`
}
type workflowTitle struct {
	Angle        string `json:"angle"`
	Key          string `json:"key"`
	Text         string `json:"text"`
	GenerationID string `json:"generation_id"`
	ConfirmedAt  string `json:"confirmed_at"`
}
type workflowCopy struct {
	Key          string   `json:"key"`
	TitleKey     string   `json:"title_key"`
	Body         string   `json:"body"`
	Topics       []string `json:"topics"`
	GenerationID string   `json:"generation_id"`
	ConfirmedAt  string   `json:"confirmed_at"`
}
type creationWorkflow struct {
	Media          *domain.VersionMedia     `json:"saved_media,omitempty"`
	StageVersions  map[string]string        `json:"stage_versions,omitempty"`
	AccountProfile workflowAccount          `json:"account_profile"`
	ID             string                   `json:"id"`
	Title          workflowTitle            `json:"title"`
	Copy           workflowCopy             `json:"copy"`
	ImagePlanID    string                   `json:"image_plan_id"`
	Drafts         map[string]workflowDraft `json:"drafts"`
	UpdatedAt      string                   `json:"updated_at"`
}
type textGeneration struct {
	Count        int              `json:"count"`
	ID           string           `json:"id"`
	ProjectID    string           `json:"project_id"`
	TitleKey     string           `json:"title_key,omitempty"`
	Titles       []string         `json:"titles,omitempty"`
	Copies       []domain.Content `json:"copies,omitempty"`
	ModelID      string           `json:"model_id"`
	Model        string           `json:"model"`
	Angle        string           `json:"angle"`
	Prompt       string           `json:"prompt"`
	PresetID     string           `json:"preset_id,omitempty"`
	PresetName   string           `json:"preset_name,omitempty"`
	PresetRev    int              `json:"preset_revision,omitempty"`
	Requirements string           `json:"requirements"`
	Reference    string           `json:"reference"`
	CreatedAt    string           `json:"created_at"`
}
type workflowImagePlan struct {
	ID           string   `json:"id"`
	ProjectID    string   `json:"project_id"`
	ParentID     string   `json:"parent_id,omitempty"`
	CopyKey      string   `json:"copy_key"`
	Scenes       []string `json:"scenes"`
	ReferenceIDs []string `json:"reference_asset_ids"`
	Model        string   `json:"model"`
	ConfirmedAt  string   `json:"confirmed_at,omitempty"`
	CreatedAt    string   `json:"created_at"`
}

// Copy legacy configurations once, rather than looking up a different catalog
// at call time. Empty or edited catalogs never inherit another stage's models.
func (a *App) initializeStageModels() error {
	models, err := a.rewriteModels()
	if err != nil {
		return err
	}
	return a.Store.Transaction(func(tx *sql.Tx) error {
		for _, scope := range []string{"angle", "title", "copy", "image-plan", "video-script"} {
			_, err := store.Get[[]rewriteModel](tx, "settings", scope+"-models")
			if errors.Is(err, sql.ErrNoRows) {
				if err = store.Put(tx, "settings", scope+"-models", models); err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
		}
		return nil
	})
}
func (a *App) planningModels(id, scope string) ([]rewriteModel, error) {
	if _, err := store.Get[creationWorkflow](a.Store.DB, "creation_workflows", id); errors.Is(err, sql.ErrNoRows) {
		return a.rewriteModels()
	}
	return a.modelsFor(scope)
}
func (a *App) readWorkflow(id string) (creationWorkflow, error) {
	w, err := store.Get[creationWorkflow](a.Store.DB, "creation_workflows", id)
	if errors.Is(err, sql.ErrNoRows) {
		w = creationWorkflow{ID: id, Drafts: map[string]workflowDraft{}}
		return w, nil
	}
	if w.Drafts == nil {
		w.Drafts = map[string]workflowDraft{}
	}
	if err == nil {
		needsMigration := false
		for _, scope := range []string{"title", "copy"} {
			if r := referenceInputFor(w, scope); r != nil && r.PolicyVersion < 1 {
				needsMigration = true
			}
		}
		if needsMigration {
			p, e := store.Get[domain.Project](a.Store.DB, "projects", id)
			if e != nil {
				return w, e
			}
			rev, e := a.workflowReference(&p)
			if e != nil {
				return w, e
			}
			if e = migrateTextReferences(&w, rev); e != nil {
				return w, e
			}
		}
	}
	return w, err
}
func (a *App) workflowCopyKey(id string) string {
	basis, err := a.storedWorkflowBasis(id)
	if err == nil {
		return basis.Copy.Key
	}
	return ""
}
func (a *App) workflowRequiresCopy(id string) error {
	_, err := store.Get[creationWorkflow](a.Store.DB, "creation_workflows", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return nil
}
func (a *App) workflowCopyText(id string) string {
	basis, err := a.storedWorkflowBasis(id)
	if err != nil {
		return ""
	}
	if strings.TrimSpace(basis.Title.Text+basis.Copy.Body+strings.Join(basis.Copy.Topics, "")) == "" {
		return ""
	}
	return "发帖角度：" + basis.Title.Angle + "\n" + basis.Title.Text + "\n" + basis.Copy.Body + "\n" + strings.Join(basis.Copy.Topics, " ")
}
func (a *App) validateWorkflowReferences(p domain.Project, ids []string) error {
	if _, err := store.Get[creationWorkflow](a.Store.DB, "creation_workflows", p.ID); errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	for _, id := range ids {
		asset, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if err != nil {
			return errors.New("参考素材不存在")
		}
		if p.NoteID != "" && asset.Source == "collection" && asset.RevisionID != p.RevisionID {
			return errors.New("每个项目只参考关联的这一篇帖子；可另外上传自己的素材")
		}
	}
	return nil
}
func (a *App) workflowRequiresImagePlan(id, planID string, scenes []string) error {
	if _, err := store.Get[creationWorkflow](a.Store.DB, "creation_workflows", id); errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err := a.workflowRequiresCopy(id); err != nil {
		return err
	}
	plan, err := store.Get[workflowImagePlan](a.Store.DB, "image_plans", planID)
	if err != nil || plan.ProjectID != id || plan.ConfirmedAt == "" || plan.CopyKey != a.workflowCopyKey(id) {
		return errors.New("请先确认当前文案对应的画面规划")
	}
	if len(scenes) == 0 {
		return errors.New("请选择已确认的具体画面")
	}
	for _, scene := range scenes {
		if !slices.Contains(plan.Scenes, strings.TrimSpace(scene)) {
			return errors.New("画面已修改，请重新确认规划后生成")
		}
	}
	return nil
}
func (a *App) creationWorkflowGet(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := get[domain.Project](a, c, "projects", c.Param("id"))
	if !ok {
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	if p.DeletedAt == "" {
		if err = store.Put(a.Store.DB, "creation_workflows", p.ID, w); err != nil {
			bad(c, err)
			return
		}
	}
	rev, err := a.workflowReference(&p)
	if err != nil {
		bad(c, err)
		return
	}
	if rev.Topics == nil {
		rev.Topics = []string{}
	}
	if rev.AssetIDs == nil {
		rev.AssetIDs = []string{}
	}
	angles, err := store.List[workflowAngleGeneration](a.Store.DB, "angle_generations")
	if err != nil {
		bad(c, err)
		return
	}
	ag := []workflowAngleGeneration{}
	for _, g := range angles {
		if g.ProjectID == p.ID {
			ag = append(ag, g)
		}
	}
	titles, _ := store.List[textGeneration](a.Store.DB, "title_generations")
	copies, _ := store.List[textGeneration](a.Store.DB, "copy_generations")
	plans, _ := store.List[workflowImagePlan](a.Store.DB, "image_plans")
	ts, cs, ps := []textGeneration{}, []textGeneration{}, []workflowImagePlan{}
	for _, v := range titles {
		if v.ProjectID == p.ID {
			ts = append(ts, v)
		}
	}
	for _, v := range copies {
		if v.ProjectID == p.ID {
			cs = append(cs, v)
		}
	}
	for _, v := range plans {
		if v.ProjectID == p.ID {
			ps = append(ps, v)
		}
	}
	prompts := map[string]string{}
	copyPrompts := map[string]string{}
	defaults, err := a.workflowDefaultPrompts()
	if err != nil {
		bad(c, err)
		return
	}
	for _, count := range []int{1, 3, 5} {
		prompts[fmt.Sprint(count)] = workflowSystemPrompt(workflowTitleSystemPrompt(count, titleLimit(p)), defaults["title"].Prompt)
	}
	for count := 1; count <= 5; count++ {
		copyPrompts[fmt.Sprint(count)] = workflowSystemPrompt(workflowCopySystemPrompt(count), defaults["copy"].Prompt)
	}
	if p.NoteID == "" {
		for key, prompt := range prompts {
			prompts[key] = prompt + originalCreationInstructions()
		}
		for key, prompt := range copyPrompts {
			copyPrompts[key] = prompt + originalCreationInstructions()
		}
	}
	c.JSON(200, gin.H{"workflow": w, "basis": workflowBasisFor(p, w, rev), "reference": rev, "titles": ts, "copies": cs, "image_plans": ps, "angles": ag, "title_system_prompts": prompts, "copy_system_prompts": copyPrompts, "media_system_prompts": map[string]string{"image": workflowSystemPrompt(workflowImagePrompt, defaults["image"].Prompt), "video": workflowSystemPrompt(workflowVideoPrompt, defaults["video"].Prompt)}})
}
func (a *App) creationWorkflowSource(c *gin.Context) {
	var req struct {
		NoteID string `json:"note_id"`
	}
	if !bind(c, &req) {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if p.NoteID != "" {
		fail(c, 409, "项目已关联一篇参考帖子，不能叠加或替换")
		return
	}
	n, ok := get[domain.Note](a, c, "notes", req.NoteID)
	if !ok {
		return
	}
	if n.DeletedAt != "" {
		fail(c, 409, "请先恢复参考帖子")
		return
	}
	rev, ok := get[domain.Revision](a, c, "revisions", n.RevisionID)
	if !ok {
		return
	}
	p.NoteID, p.RevisionID, p.Platform = n.ID, rev.ID, n.Platform
	p.Sources = []domain.Source{{ID: "original", Label: "原始笔记", Text: rev.Title + "\n" + rev.Body}}
	if err := store.Put(a.Store.DB, "projects", p.ID, p); err != nil {
		bad(c, err)
		return
	}
	c.JSON(200, p)
}
func (a *App) creationWorkflowDraft(c *gin.Context) {
	step := c.Param("step")
	if !slices.Contains([]string{"source", "account", "angle", "title", "copy", "image-plan", "image", "video-script", "video", "publish"}, step) {
		fail(c, 400, "未知步骤")
		return
	}
	var req struct {
		Revision int             `json:"revision"`
		Data     json.RawMessage `json:"data"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.Data) > 128000 || !json.Valid(req.Data) {
		fail(c, 400, "草稿内容无效或过长")
		return
	}
	if step == "account" {
		var fields workflowAccountFields
		if json.Unmarshal(req.Data, &fields) != nil {
			fail(c, 400, "基本信息草稿无效")
			return
		}
		if _, err := normalizeWorkflowAccount(fields); err != nil {
			bad(c, err)
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	if w.Drafts[step].Revision != req.Revision {
		fail(c, 409, "草稿已在其他页面更新，请刷新后继续")
		return
	}
	d := workflowDraft{Revision: req.Revision + 1, Data: req.Data, SavedAt: Now()}
	w.Drafts[step] = d
	w.UpdatedAt = Now()
	if step == "source" {
		rev, err := a.originalInputRevision(p, req.Data)
		if err != nil {
			bad(c, err)
			return
		}
		old, err := a.workflowReference(&p)
		if err != nil {
			bad(c, err)
			return
		}
		if sameOriginalInput(old, rev) {
			rev = old
		}
		p.RevisionID, p.Kind = rev.ID, rev.Kind
		p.Sources = []domain.Source{{ID: "original", Label: "创作输入", Text: originalInputText(rev)}}
		err = a.Store.Transaction(func(tx *sql.Tx) error {
			if err := store.Put(tx, "revisions", rev.ID, rev); err != nil {
				return err
			}
			if err := store.Put(tx, "projects", p.ID, p); err != nil {
				return err
			}
			return store.Put(tx, "creation_workflows", p.ID, w)
		})
		if err != nil {
			bad(c, err)
			return
		}
		c.JSON(200, gin.H{"revision": d.Revision, "data": d.Data, "saved_at": d.SavedAt, "project": p, "reference": rev, "basis": workflowBasisFor(p, w, rev)})
		return
	}
	if err = store.Put(a.Store.DB, "creation_workflows", p.ID, w); err != nil {
		bad(c, err)
		return
	}
	c.JSON(200, d)
}

type workflowTextRequest struct {
	Count        int    `json:"count"`
	Angle        string `json:"angle"`
	ModelID      string `json:"model_id"`
	PresetID     string `json:"preset_id"`
	Prompt       string `json:"prompt"`
	Requirements string `json:"requirements"`
}

func (a *App) generateTitles(c *gin.Context) { a.enqueueWorkflowText(c, "title") }
func (a *App) generateCopies(c *gin.Context) { a.enqueueWorkflowText(c, "copy") }
func (a *App) enqueueWorkflowText(c *gin.Context, scope string) {
	var req workflowTextRequest
	if !bind(c, &req) {
		return
	}
	count, err := workflowTextGenerationCount(scope, req.Count)
	if err != nil {
		bad(c, err)
		return
	}
	if len([]rune(req.Angle)) > 500 {
		fail(c, 400, "发帖角度不超过500字")
		return
	}
	if len([]rune(req.Prompt)) > 4000 || len([]rune(req.Requirements)) > 4000 {
		fail(c, 400, "提示词和要求各不超过4000字")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	rev, err := a.workflowReference(&p)
	if err != nil {
		bad(c, err)
		return
	}
	basis := workflowBasisFor(p, w, rev)
	models, err := a.modelsFor(scope)
	if err != nil {
		bad(c, err)
		return
	}
	var model *rewriteModel
	for i := range models {
		if models[i].ID == req.ModelID {
			model = &models[i]
		}
	}
	if model == nil || model.Secret == "" {
		fail(c, 400, "请配置并选择当前环节的模型")
		return
	}
	choice, err := selectedWorkflowPrompt(w, scope)
	if err != nil {
		bad(c, err)
		return
	}
	var preset workflowPrompt
	if choice == nil {
		preset, err = a.resolveWorkflowPrompt(scope, req.PresetID)
		if err != nil {
			bad(c, err)
			return
		}
	}
	if scope == "copy" {
		req.Angle = basis.Title.Angle
	}
	kind := scope + "_rewrite"
	if a.videoBusy(p.ID, kind) {
		fail(c, 409, "当前环节已有生成任务")
		return
	}
	reference := "原始标题：" + rev.Title + "\n原始正文：\n" + rev.Body + "\n原始话题标签：" + strings.Join(rev.Topics, " ")
	if scope == "copy" {
		reference = rev.Body + "\n" + strings.Join(rev.Topics, " ")
	}
	if p.NoteID == "" {
		if referenceInputFor(w, scope) == nil && strings.TrimSpace(rev.Title+rev.Body+strings.Join(rev.Topics, "")+req.Requirements+workflowAccountPrompt(w.AccountProfile)+basis.Title.Text) == "" {
			fail(c, 400, "请填写创作内容、基本信息或补充要求")
			return
		}
		reference = originalInputText(rev)
	}
	selection := referenceInputFor(w, scope)
	if selection == nil {
		title, body, topics := rev.Title, rev.Body, rev.Topics
		if scope == "title" && w.Copy.Key != "" {
			body, topics = w.Copy.Body, w.Copy.Topics
		}
		if scope == "copy" && w.Title.Key != "" {
			title = w.Title.Text
		}
		selection = &workflowReferenceInput{Title: title, Body: body, Topics: topics, UseTitle: title != "", UseBody: body != ""}
	}
	refs, err := a.referenceInputImages(p, selection)
	if err != nil {
		bad(c, err)
		return
	}
	if len(refs) > 0 && !model.Vision {
		fail(c, 400, "当前模型不支持参考图片，请取消图片勾选或选择支持图片理解的模型")
		return
	}
	if selection != nil {
		reference = selection.text()
		basis.Title.Text = ""
	}
	j := newJob(kind, p.ID, map[string]any{"title_limit": titleLimit(p), "angle": strings.TrimSpace(req.Angle), "model_id": model.ID, "model": model.Model, "model_name": model.Name, "prompt": req.Prompt, "requirements": req.Requirements, "reference": reference, "title": basis.Title.Text, "title_key": basis.Title.Key, "revision_id": rev.ID, "preset_id": preset.ID, "preset_name": preset.Name, "preset_revision": preset.Revision})
	if choice != nil {
		j.Payload["system_prompt_choice"] = choice
	}
	// Store the selected title as result metadata without adding a hidden model input.
	if scope == "copy" && selection != nil && selection.UseTitle {
		j.Payload["result_title"] = selection.Title
	}
	j.Payload["reference_images"] = refs
	j.Payload["account_context"] = workflowAccountPrompt(w.AccountProfile)
	j.Payload["original_creation"] = p.NoteID == ""
	j.Payload["count"] = count
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		if err := store.Put(tx, "creation_workflows", p.ID, w); err != nil {
			return err
		}
		if err := store.Put(tx, "settings", kind+"-job-"+j.ID, model.Service); err != nil {
			return err
		}
		if preset.ID != "" {
			if err := store.Put(tx, "settings", "workflow-prompt-job-"+j.ID, preset.Prompt); err != nil {
				return err
			}
		}
		return store.Put(tx, "jobs", j.ID, j)
	})
	if err != nil {
		bad(c, err)
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}
func (a *App) runTitleRewrite(j domain.Job) (string, error) { return a.runWorkflowText(j, "title") }
func (a *App) runCopyRewrite(j domain.Job) (string, error)  { return a.runWorkflowText(j, "copy") }
func (a *App) runWorkflowText(j domain.Job, scope string) (string, error) {
	table := scope + "_generations"
	if scope == "title" {
		table = "title_generations"
	}
	if old, err := store.Get[textGeneration](a.Store.DB, table, j.ID); err == nil {
		return old.ID, nil
	}
	p, err := store.Get[domain.Project](a.Store.DB, "projects", j.Target)
	if err != nil || p.DeletedAt != "" {
		return "", errors.New("项目不可用")
	}
	svc, err := store.Get[domain.Service](a.Store.DB, "settings", j.Kind+"-job-"+j.ID)
	if err != nil {
		return "", err
	}
	count, err := workflowTextGenerationCount(scope, promptRevision(j.Payload["count"]))
	if err != nil {
		return "", err
	}
	system := workflowTitleSystemPrompt(count, titleLimit(p))
	if scope == "copy" {
		system = workflowCopySystemPrompt(count)
	}
	if j.Payload["original_creation"] == true {
		system += originalCreationInstructions()
	}
	if asString(j.Payload["preset_id"]) != "" {
		presetBody, presetErr := store.Get[string](a.Store.DB, "settings", "workflow-prompt-job-"+j.ID)
		if presetErr != nil {
			return "", presetErr
		}
		system = workflowSystemPrompt(system, presetBody)
	}
	if raw, exists := j.Payload["system_prompt_choice"]; exists {
		data, _ := json.Marshal(raw)
		var choice workflowPromptChoice
		if err := json.Unmarshal(data, &choice); err != nil {
			return "", err
		}
		format := fmt.Sprintf("只返回JSON；必须恰好输出%d项。", count)
		if scope == "title" {
			format += fmt.Sprintf(`格式 {"titles":["完整标题"]}；每个标题最多%d字。`, titleLimit(p))
		} else {
			format += `格式 {"copies":[{"body":"完整正文","topics":["话题"]}]}。`
		}
		system = format + "\n" + choice.effective()
	}
	user := "发帖角度（留空沿用原帖）：" + asString(j.Payload["angle"]) + "\n提示词：" + asString(j.Payload["prompt"]) + "\n补充要求：" + asString(j.Payload["requirements"]) + "\n参考资料：\n" + asString(j.Payload["reference"])
	if scope == "copy" {
		user = "当前标题：" + asString(j.Payload["title"]) + "\n" + user
	}
	user += asString(j.Payload["account_context"])
	content, err := a.referenceChatContent(user, j.Payload)
	if err != nil {
		return "", err
	}
	result, err := a.chat(svc, []any{map[string]any{"role": "system", "content": system}, map[string]any{"role": "user", "content": content}}, true)
	if err != nil {
		return "", err
	}
	result = strings.TrimSpace(result)
	result = strings.TrimPrefix(result, "```json")
	result = strings.TrimPrefix(result, "```")
	result = strings.TrimSuffix(strings.TrimSpace(result), "```")
	var record textGeneration
	if err = json.Unmarshal([]byte(result), &record); err != nil {
		return "", errors.New("模型返回格式无效，请重新生成")
	}
	if scope == "title" {
		if len(record.Titles) != count {
			return "", fmt.Errorf("模型必须返回%d个候选标题", count)
		}
		seen := map[string]bool{}
		for i, t := range record.Titles {
			t = strings.TrimSpace(t)
			if t == "" || len([]rune(t)) > titleLimit(p) || seen[t] {
				return "", errors.New("候选标题为空、重复或超过平台字数限制（小红书最多20字），请重新生成或手动填写")
			}
			record.Titles[i] = t
			seen[t] = true
		}
		record.Copies = nil
	} else {
		if len(record.Copies) != count {
			return "", fmt.Errorf("模型必须返回%d份候选文案", count)
		}
		for i, v := range record.Copies {
			if strings.TrimSpace(v.Body) == "" || len([]rune(v.Body)) > 12000 {
				return "", errors.New("候选文案为空或过长")
			}
			record.Copies[i].Title = asString(j.Payload["result_title"])
			if _, ok := j.Payload["result_title"]; !ok {
				record.Copies[i].Title = asString(j.Payload["title"])
			}
		}
		record.Titles = nil
	}
	record.ID, record.ProjectID, record.CreatedAt = j.ID, j.Target, Now()
	record.Count = count
	record.TitleKey = asString(j.Payload["title_key"])
	record.Angle = asString(j.Payload["angle"])
	record.ModelID, record.Model = asString(j.Payload["model_id"]), svc.Model
	record.Prompt, record.Requirements, record.Reference = asString(j.Payload["prompt"]), asString(j.Payload["requirements"]), asString(j.Payload["reference"])
	record.PresetID, record.PresetName, record.PresetRev = asString(j.Payload["preset_id"]), asString(j.Payload["preset_name"]), promptRevision(j.Payload["preset_revision"])
	a.mu.Lock()
	defer a.mu.Unlock()
	return record.ID, store.Put(a.Store.DB, table, record.ID, record)
}
func (a *App) confirmTitle(c *gin.Context) {
	var req struct {
		Angle        string `json:"angle"`
		Text         string `json:"text"`
		GenerationID string `json:"generation_id"`
	}
	if !bind(c, &req) {
		return
	}
	req.Angle = strings.TrimSpace(req.Angle)
	if len([]rune(req.Angle)) > 500 {
		fail(c, 400, "发帖角度不超过500字")
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		fail(c, 400, "请填写标题")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if err := validateProjectTitle(p, req.Text); err != nil {
		bad(c, err)
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	if req.GenerationID != "" {
		g, e := store.Get[textGeneration](a.Store.DB, "title_generations", req.GenerationID)
		if e != nil || g.ProjectID != p.ID {
			fail(c, 400, "标题生成记录不属于当前项目")
			return
		}
	}
	if w.Title.Text != req.Text || w.Title.Angle != req.Angle || w.Title.Key == "" {
		w.Title = workflowTitle{Key: ID(), Text: req.Text, Angle: req.Angle, GenerationID: req.GenerationID, ConfirmedAt: Now()}
	}
	w.UpdatedAt = Now()
	if err = store.Put(a.Store.DB, "creation_workflows", p.ID, w); err != nil {
		bad(c, err)
		return
	}
	c.JSON(200, w)
}
func (a *App) confirmCopy(c *gin.Context) {
	var req struct {
		Body         string   `json:"body"`
		Topics       []string `json:"topics"`
		TitleKey     string   `json:"title_key"`
		GenerationID string   `json:"generation_id"`
	}
	if !bind(c, &req) {
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" || len([]rune(req.Body)) > 12000 || len(req.Topics) > 30 {
		fail(c, 400, "请填写完整正文（最多12000字，话题最多30个）")
		return
	}
	for _, t := range req.Topics {
		if len([]rune(t)) > 80 {
			fail(c, 400, "单个话题最多80字")
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	basis, err := a.readWorkflowBasis(p, w)
	if err != nil {
		bad(c, err)
		return
	}
	if req.TitleKey != basis.Title.Key && (req.TitleKey != "" || w.Title.Key != "") {
		fail(c, 409, "标题已经变化，请检查文案后重新确认")
		return
	}
	if req.GenerationID != "" {
		g, e := store.Get[textGeneration](a.Store.DB, "copy_generations", req.GenerationID)
		if e != nil || g.ProjectID != p.ID || g.TitleKey != basis.Title.Key {
			fail(c, 400, "文案生成记录与当前标题不匹配")
			return
		}
	}
	if w.Copy.Body != req.Body || !slices.Equal(w.Copy.Topics, req.Topics) || w.Copy.TitleKey != basis.Title.Key || w.Copy.Key == "" {
		w.Copy = workflowCopy{Key: ID(), TitleKey: basis.Title.Key, Body: req.Body, Topics: req.Topics, GenerationID: req.GenerationID, ConfirmedAt: Now()}
	}
	w.UpdatedAt = Now()
	if err = store.Put(a.Store.DB, "creation_workflows", p.ID, w); err != nil {
		bad(c, err)
		return
	}
	c.JSON(200, w)
}
func (a *App) confirmImagePlan(c *gin.Context) {
	var req struct {
		ParentID     string   `json:"parent_id"`
		Scenes       []string `json:"scenes"`
		CopyKey      string   `json:"copy_key"`
		ReferenceIDs []string `json:"reference_asset_ids"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.Scenes) < 1 || len(req.Scenes) > 6 {
		fail(c, 400, "请规划1至6张图片")
		return
	}
	for i, s := range req.Scenes {
		req.Scenes[i] = strings.TrimSpace(s)
		if req.Scenes[i] == "" || len([]rune(s)) > 1000 {
			fail(c, 400, "每张画面需填写1至1000字")
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if err := a.workflowRequiresCopy(p.ID); err != nil {
		bad(c, err)
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	basis, err := a.readWorkflowBasis(p, w)
	if err != nil {
		bad(c, err)
		return
	}
	if req.CopyKey != basis.Copy.Key {
		fail(c, 409, "文案已变化，请检查画面规划")
		return
	}
	if err = a.validateWorkflowReferences(p, req.ReferenceIDs); err != nil {
		bad(c, err)
		return
	}
	model := "手动规划"
	if req.ParentID != "" {
		parent, e := store.Get[workflowImagePlan](a.Store.DB, "image_plans", req.ParentID)
		if e != nil || parent.ProjectID != p.ID {
			fail(c, 400, "规划来源不存在")
			return
		}
		model = parent.Model
	}
	plan := workflowImagePlan{ID: ID(), ProjectID: p.ID, ParentID: req.ParentID, CopyKey: basis.Copy.Key, Scenes: req.Scenes, ReferenceIDs: req.ReferenceIDs, Model: model, ConfirmedAt: Now(), CreatedAt: Now()}
	w.ImagePlanID = plan.ID
	w.UpdatedAt = Now()
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "image_plans", plan.ID, plan); e != nil {
			return e
		}
		return store.Put(tx, "creation_workflows", p.ID, w)
	})
	if err != nil {
		bad(c, err)
		return
	}
	c.JSON(201, plan)
}
func (a *App) releaseCreationWorkflow(c *gin.Context) {
	var req struct {
		Name          string              `json:"name"`
		CopyKey       string              `json:"copy_key"`
		Media         domain.VersionMedia `json:"media"`
		MediaReviewed bool                `json:"media_reviewed"`
	}
	if !bind(c, &req) {
		return
	}
	if len([]rune(req.Name)) > 80 {
		fail(c, 400, "版本名称最多80字")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if err := a.workflowRequiresCopy(p.ID); err != nil {
		bad(c, err)
		return
	}
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	basis, err := a.readWorkflowBasis(p, w)
	if err != nil {
		bad(c, err)
		return
	}
	if req.CopyKey != basis.Copy.Key || !req.MediaReviewed {
		fail(c, 409, "请检查素材是否与当前文案匹配后再保存")
		return
	}
	v := domain.Version{ID: ID(), ProjectID: p.ID, Name: strings.TrimSpace(req.Name), Content: domain.Content{Title: basis.Title.Text, Body: basis.Copy.Body, Topics: basis.Copy.Topics}, Media: &req.Media, Status: "confirmed", CreatedAt: Now(), ConfirmedAt: Now(), SourceIDs: []string{"original"}, SourceSnapshot: p.Sources, WorkflowSnapshot: map[string]string{"angle": basis.Title.Angle, "title_key": basis.Title.Key, "copy_key": basis.Copy.Key, "title_generation_id": basis.Title.GenerationID, "copy_generation_id": basis.Copy.GenerationID, "image_plan_id": w.ImagePlanID, "reference_revision_id": p.RevisionID}}
	if err = a.validateVersionMedia(v.Media); err != nil {
		bad(c, err)
		return
	}
	if err = a.requireCompleteVersion(v); err != nil {
		bad(c, err)
		return
	}
	records, err := a.snapshotGenerationRecords(v.Media)
	if err != nil {
		bad(c, err)
		return
	}
	v.GenerationRecords = records
	all, err := store.List[domain.Version](a.Store.DB, "versions")
	if err != nil {
		bad(c, err)
		return
	}
	v.Number = 1
	for _, old := range all {
		if old.ProjectID != p.ID || old.Generated {
			continue
		}
		if old.Number >= v.Number {
			v.Number = old.Number + 1
		}
		if old.Status == "confirmed" && sameVersionContent(old, v) && old.WorkflowSnapshot["copy_key"] == basis.Copy.Key {
			if p.SelectedVersions == nil {
				p.SelectedVersions = map[string]string{}
			}
			p.SelectedVersions[v.Media.Kind] = old.ID
			if err = store.Put(a.Store.DB, "projects", p.ID, p); err != nil {
				bad(c, err)
				return
			}
			c.JSON(200, old)
			return
		}
	}
	if v.Name == "" {
		v.Name = fmt.Sprintf("发布稿 V%d", v.Number)
	}
	ensureMediaSelections(&p)
	p.Kind, p.AssetIDs, p.CoverID = v.Media.Kind, v.Media.AssetIDs, v.Media.CoverID
	p.MediaSelections[p.Kind] = domain.MediaSelection{AssetIDs: p.AssetIDs, CoverID: p.CoverID}
	if p.SelectedVersions == nil {
		p.SelectedVersions = map[string]string{}
	}
	p.SelectedVersions[p.Kind] = v.ID
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "versions", v.ID, v); e != nil {
			return e
		}
		return store.Put(tx, "projects", p.ID, p)
	})
	if err != nil {
		bad(c, err)
		return
	}
	c.JSON(201, v)
}
