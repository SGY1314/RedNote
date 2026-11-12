package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/store"
)

const workflowPromptsKey = "workflow-prompts"

var workflowPromptScopes = []string{"title", "copy", "image", "video-script", "video"}

type workflowPrompt struct {
	ID          string `json:"id"`
	Scope       string `json:"scope"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
	Enabled     bool   `json:"enabled"`
	Default     bool   `json:"is_default"`
	Revision    int    `json:"revision"`
	UpdatedAt   string `json:"updated_at"`
}

type publicWorkflowPrompt struct {
	ID          string `json:"id"`
	Scope       string `json:"scope"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Default     bool   `json:"is_default"`
	Revision    int    `json:"revision"`
	Prompt      string `json:"prompt"`
}

func workflowPromptScope(scope string) bool {
	return scope == "title" || scope == "copy" || scope == "image" || scope == "video" || scope == "video-script"
}

func workflowSystemPrompt(base, strategy string) string {
	if strings.TrimSpace(strategy) == "" {
		return base
	}
	return base + "\n管理员系统提示词：\n" + strings.TrimSpace(strategy) + "\n以上基础范围、数量与输出格式必须保持。"
}

func (a *App) workflowDefaultPrompts() (map[string]workflowPrompt, error) {
	items, err := readWorkflowPrompts(a.Store.DB)
	if err != nil {
		return nil, err
	}
	normalizeWorkflowPromptDefaults(items)
	defaults := map[string]workflowPrompt{}
	for _, item := range items {
		if workflowPromptScope(item.Scope) && item.Enabled && item.Default {
			defaults[item.Scope] = item
		}
	}
	return defaults, nil
}

func promptRevision(value any) int {
	switch number := value.(type) {
	case int:
		return number
	case float64:
		return int(number)
	default:
		return 0
	}
}

func readWorkflowPrompts(db *sql.DB) ([]workflowPrompt, error) {
	items, err := store.Get[[]workflowPrompt](db, "settings", workflowPromptsKey)
	if errors.Is(err, sql.ErrNoRows) {
		return []workflowPrompt{}, nil
	}
	return items, err
}

func normalizeWorkflowPromptDefaults(items []workflowPrompt) {
	for _, scope := range workflowPromptScopes {
		selected := -1
		for i := range items {
			if items[i].Scope == scope && items[i].Enabled && items[i].Default {
				selected = i
				break
			}
		}
		if selected < 0 {
			for i := range items {
				if items[i].Scope == scope && items[i].Enabled {
					selected = i
					break
				}
			}
		}
		for i := range items {
			if items[i].Scope == scope {
				items[i].Default = i == selected
			}
		}
	}
}

func (a *App) resolveWorkflowPrompt(scope, id string) (workflowPrompt, error) {
	items, err := readWorkflowPrompts(a.Store.DB)
	if err != nil {
		return workflowPrompt{}, err
	}
	normalizeWorkflowPromptDefaults(items)
	if id != "" {
		for _, item := range items {
			if item.ID == id && item.Scope == scope && item.Enabled {
				return item, nil
			}
		}
		return workflowPrompt{}, errors.New("提示词方案已停用或不存在，请重新选择")
	}
	for _, item := range items {
		if item.Scope == scope && item.Enabled && item.Default {
			return item, nil
		}
	}
	return workflowPrompt{}, nil
}

func (a *App) workflowPromptCatalog(c *gin.Context) {
	items, err := readWorkflowPrompts(a.Store.DB)
	if err != nil {
		fail(c, 500, "读取创作方案失败")
		return
	}
	public := []publicWorkflowPrompt{}
	for _, item := range items {
		if item.Enabled && workflowPromptScope(item.Scope) {
			public = append(public, publicWorkflowPrompt{item.ID, item.Scope, item.Name, item.Description, item.Default, item.Revision, item.Prompt})
		}
	}
	c.JSON(200, public)
}

func (m *MultiApp) adminWorkflowPrompts(c *gin.Context) {
	items, err := readWorkflowPrompts(m.Model.Store.DB)
	if err != nil {
		fail(c, 500, "读取提示词方案失败")
		return
	}
	active := []workflowPrompt{}
	for _, item := range items {
		if workflowPromptScope(item.Scope) {
			active = append(active, item)
		}
	}
	c.JSON(200, active)
}

func (m *MultiApp) adminWorkflowPromptSave(c *gin.Context) {
	var req workflowPrompt
	if !bind(c, &req) {
		return
	}
	req.Scope, req.Name, req.Description, req.Prompt = strings.TrimSpace(req.Scope), strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), strings.TrimSpace(req.Prompt)
	if !workflowPromptScope(req.Scope) {
		fail(c, 400, "系统提示词仅支持标题、文案、图片、视频脚本和视频生成")
		return
	}
	if req.Name == "" || req.Prompt == "" || len([]rune(req.Name)) > 60 || len([]rune(req.Description)) > 160 || len([]rune(req.Prompt)) > 4000 {
		fail(c, 400, "请填写环节、名称和提示词；名称最多60字，说明最多160字，提示词最多4000字")
		return
	}
	m.Model.mu.Lock()
	items, err := readWorkflowPrompts(m.Model.Store.DB)
	if err != nil {
		m.Model.mu.Unlock()
		fail(c, 500, "读取提示词方案失败")
		return
	}
	id := c.Param("id")
	index := -1
	for i := range items {
		if items[i].ID == id {
			index = i
			break
		}
	}
	if id != "" && index < 0 {
		m.Model.mu.Unlock()
		fail(c, 404, "提示词方案不存在")
		return
	}
	activeCount := 0
	for _, item := range items {
		if workflowPromptScope(item.Scope) {
			activeCount++
		}
	}
	if id == "" && activeCount >= 60 {
		m.Model.mu.Unlock()
		fail(c, 400, "提示词方案数量已达上限")
		return
	}
	if index >= 0 && req.Revision != items[index].Revision {
		m.Model.mu.Unlock()
		fail(c, 409, "模板已在其他窗口更新，当前输入已保留，请核对最新版本")
		return
	}
	if index >= 0 {
		req.ID = id
		req.Revision = items[index].Revision + 1
	} else {
		req.ID = ID()
		req.Revision = 1
	}
	req.UpdatedAt = Now()
	if req.Default && req.Enabled {
		for i := range items {
			if items[i].Scope == req.Scope {
				items[i].Default = false
			}
		}
	}
	if index >= 0 {
		items[index] = req
	} else {
		index = len(items)
		items = append(items, req)
	}
	normalizeWorkflowPromptDefaults(items)
	req = items[index]
	err = store.Put(m.Model.Store.DB, "settings", workflowPromptsKey, items)
	m.Model.mu.Unlock()
	if err != nil {
		fail(c, 500, "保存提示词方案失败")
		return
	}
	m.propagateServerConfig()
	m.audit(m.currentUser(c), "保存提示词方案", req.Scope+" / "+req.Name, c.ClientIP())
	c.JSON(200, req)
}

func (m *MultiApp) adminWorkflowPromptDelete(c *gin.Context) {
	id := c.Param("id")
	m.Model.mu.Lock()
	items, err := readWorkflowPrompts(m.Model.Store.DB)
	if err != nil {
		m.Model.mu.Unlock()
		fail(c, 500, "读取提示词方案失败")
		return
	}
	index := -1
	for i := range items {
		if items[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		m.Model.mu.Unlock()
		fail(c, 404, "提示词方案不存在")
		return
	}
	removed := items[index]
	items = append(items[:index], items[index+1:]...)
	normalizeWorkflowPromptDefaults(items)
	err = store.Put(m.Model.Store.DB, "settings", workflowPromptsKey, items)
	m.Model.mu.Unlock()
	if err != nil {
		fail(c, 500, "删除提示词方案失败")
		return
	}
	m.propagateServerConfig()
	m.audit(m.currentUser(c), "删除提示词方案", removed.Scope+" / "+removed.Name, c.ClientIP())
	c.JSON(200, gin.H{"deleted": true, "id": id})
}

// An explicit per-project selection replaces the creative template, including
// the disabled state. Protocol/output requirements are enforced separately.
func selectedWorkflowPrompt(w creationWorkflow, scope string) (*workflowPromptChoice, error) {
	d, ok := w.Drafts[scope]
	if !ok {
		return nil, nil
	}
	raw, _ := json.Marshal(d.Data)
	var v struct {
		Prompt *workflowPromptChoice `json:"system_prompt_choice"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	if v.Prompt != nil && len([]rune(v.Prompt.Text)) > 8000 {
		return nil, errors.New("系统提示词最多8000字")
	}
	return v.Prompt, nil
}

type workflowPromptChoice struct {
	Enabled          bool   `json:"enabled"`
	Text             string `json:"text"`
	TemplateID       string `json:"template_id"`
	TemplateRevision int    `json:"template_revision"`
}

func (v *workflowPromptChoice) effective() string {
	if !v.Enabled {
		return ""
	}
	return strings.TrimSpace(v.Text)
}
