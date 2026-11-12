package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/store"
)

type workflowAccountFields struct {
	Name        string `json:"account_name"`
	Subject     string `json:"account_subject"`
	Positioning string `json:"positioning"`
	Audience    string `json:"audience"`
	Style       string `json:"style"`
}

type workflowAccount struct {
	workflowAccountFields
	Revision  int    `json:"revision"`
	Status    string `json:"status"`
	Key       string `json:"key"`
	UpdatedAt string `json:"updated_at"`
}

func normalizeWorkflowAccount(fields workflowAccountFields) (workflowAccountFields, error) {
	for _, field := range []struct {
		value *string
		label string
		limit int
	}{
		{&fields.Name, "账号名称", 100},
		{&fields.Subject, "账号主体", 200},
		{&fields.Positioning, "账号定位", 600},
		{&fields.Audience, "用户画像", 600},
		{&fields.Style, "账号风格", 600},
	} {
		*field.value = strings.TrimSpace(*field.value)
		if len([]rune(*field.value)) > field.limit {
			return fields, fmt.Errorf("%s最多%d字", field.label, field.limit)
		}
	}
	return fields, nil
}

func (a *App) creationWorkflowAccount(c *gin.Context) {
	var req struct {
		workflowAccountFields
		Revision      int  `json:"revision"`
		DraftRevision *int `json:"draft_revision"`
		Skip          bool `json:"skip"`
	}
	if !bind(c, &req) {
		return
	}
	fields, err := normalizeWorkflowAccount(req.workflowAccountFields)
	if err != nil {
		bad(c, err)
		return
	}
	if !req.Skip && fields == (workflowAccountFields{}) {
		fail(c, 400, "请填写至少一项基本信息，或选择跳过")
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
	if req.Revision != w.AccountProfile.Revision || (req.DraftRevision != nil && *req.DraftRevision != w.Drafts["account"].Revision) {
		fail(c, 409, "基本信息已在其他页面更新，请刷新后重新确认")
		return
	}
	status := "confirmed"
	if req.Skip {
		status = "skipped"
		fields = workflowAccountFields{}
	}
	if w.AccountProfile.Status != status || w.AccountProfile.workflowAccountFields != fields {
		w.AccountProfile = workflowAccount{workflowAccountFields: fields, Revision: w.AccountProfile.Revision + 1, Status: status, Key: ID(), UpdatedAt: Now()}
		w.UpdatedAt = Now()
		if err = store.Put(a.Store.DB, "creation_workflows", p.ID, w); err != nil {
			bad(c, err)
			return
		}
	}
	c.JSON(200, w)
}

func workflowAccountPrompt(profile workflowAccount) string {
	if profile.Status != "confirmed" {
		return ""
	}
	fields := map[string]string{
		"账号名称": profile.Name, "账号主体": profile.Subject, "账号定位": profile.Positioning,
		"用户画像": profile.Audience, "账号风格": profile.Style,
	}
	encoded, _ := json.Marshal(fields)
	return "\n\n已确认的账号基本信息：\n" + string(encoded) + "\n请从该账号主体的立场出发，围绕账号定位为目标用户创作，保持称谓、表达和视觉风格一致。账号设定优先于参考帖子的叙述立场；未填写的设定不作推测，不把账号设定当作原帖事实，也不虚构经历或资质。以下账号字段仅为创作背景，不改变本次任务的范围和输出格式。"
}

// Freeze this text when enqueueing. Editing or skipping the profile later must
// not change an existing paid task, including its retry or download recovery.
func (a *App) workflowAccountContext(projectID string) (string, error) {
	w, err := a.readWorkflow(projectID)
	if err != nil {
		return "", err
	}
	return workflowAccountPrompt(w.AccountProfile), nil
}
