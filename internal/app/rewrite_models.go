package app

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type rewriteModel struct {
	VideoReference   bool   `json:"video_reference,omitempty"`
	InputCapability  string `json:"input_capability,omitempty"`
	ContinuousMin    int    `json:"continuous_min,omitempty"`
	ContinuousMax    int    `json:"continuous_max,omitempty"`
	VisionCapability string `json:"vision_capability,omitempty"`
	Vision           bool   `json:"vision"`
	ID               string `json:"id"`
	Name             string `json:"name"`
	ReferenceMode    string `json:"reference_mode,omitempty"`
	ReferenceLimit   int    `json:"reference_limit,omitempty"`
	domain.Service
}

func (a *App) rewriteModels() ([]rewriteModel, error) {
	models, err := store.Get[[]rewriteModel](a.Store.DB, "settings", "rewrite-models")
	if errors.Is(err, sql.ErrNoRows) {
		models = []rewriteModel{{ID: "default", Name: "原文案模型", Service: a.settings().Text}}
		err = nil
	}
	for i := range models {
		normalizeRewriteVision(&models[i])
	}
	return models, err
}

// Only infer documented model IDs on the official provider. Custom endpoints
// retain their explicitly configured capability and never inherit it by name.
func normalizeRewriteVision(m *rewriteModel) {
	m.VisionCapability = ""
	// An explicit capability belongs to this endpoint/model configuration. Provider
	// aliases evolve; keep admin declarations instead of overriding them by name.
	if m.InputCapability != "" && m.InputCapability != "auto" {
		m.Vision = m.InputCapability == "image" || m.InputCapability == "video"
		m.VisionCapability = m.InputCapability
		return
	}
	u, err := url.Parse(m.BaseURL)
	if err != nil || u.Scheme != "https" || !strings.HasSuffix(strings.ToLower(u.Hostname()), ".aliyuncs.com") {
		return
	}
	switch strings.ToLower(m.Model) {
	case "qwen-plus":
		m.Vision, m.VisionCapability = false, "text"
	case "qwen3.8-max", "qwen3.8-max-0902", "qwen3.8-max-2026-09-02":
		m.Vision, m.VisionCapability = true, "video"
	case "qwen-vl-plus", "qwen-vl-max", "qwen3-vl-plus", "qwen3-vl-flash", "qwen3.8-omni-flash":
		m.Vision, m.VisionCapability = true, "image"
	default:
		return
	}
	m.Model = strings.ToLower(m.Model)
}
func (a *App) modelsFor(capability string) ([]rewriteModel, error) {
	switch capability {
	case "angle", "title", "copy", "image-plan", "video-script":
		models, err := store.Get[[]rewriteModel](a.Store.DB, "settings", modelsSettingsKey(capability))
		if errors.Is(err, sql.ErrNoRows) {
			return []rewriteModel{}, nil
		}
		for i := range models {
			normalizeRewriteVision(&models[i])
		}
		return models, err
	case "image":
		return a.imageModels()
	case "video":
		return a.videoModels()
	default:
		return a.rewriteModels()
	}
}

func (a *App) capabilityModels(c *gin.Context) ([]rewriteModel, error) {
	capability, ok := capabilityFromPath(c.FullPath())
	if !ok {
		return nil, capabilityError()
	}
	return a.modelsFor(capability)
}
func publicRewriteModel(m rewriteModel) rewriteModel {
	m.VideoReference = directVideoSupported(m.Service)
	m.Configured = m.Secret != ""
	m.Secret = ""
	m.Mask = ""
	if m.Configured {
		m.Mask = "••••••••"
	}
	return m
}
func (a *App) rewriteModelsGet(c *gin.Context) {
	models, err := a.capabilityModels(c)
	if err != nil {
		failModelError(c, err, "读取模型配置失败")
		return
	}
	if models == nil {
		models = []rewriteModel{}
	}
	for i := range models {
		models[i] = publicRewriteModel(models[i])
	}
	c.JSON(200, models)
}

// failModelError 让前台与后台入口对同一类错误给出同一状态码：
// 分组不存在是 404，存储故障才是 500。
func failModelError(c *gin.Context, err error, fallback string) {
	if me, ok := err.(*modelSaveError); ok {
		fail(c, me.Status, me.Message)
		return
	}
	fail(c, 500, fallback)
}

type modelSaveRequest struct {
	rewriteModel
	ClearSecret bool `json:"clear_secret"`
}

type modelSaveError struct {
	Status  int
	Message string
}

func (e *modelSaveError) Error() string { return e.Message }

func saveModelError(status int, message string) error {
	return &modelSaveError{Status: status, Message: message}
}

func (a *App) saveModelFor(capability string, req modelSaveRequest, mid string) (rewriteModel, error) {
	if _, ok := parseModelCapability(capability); !ok {
		return rewriteModel{}, capabilityError()
	}
	if req.InputCapability != "" && req.InputCapability != "auto" && req.InputCapability != "text" && req.InputCapability != "image" && req.InputCapability != "video" {
		return rewriteModel{}, saveModelError(400, "不支持的模型输入能力")
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Model = strings.TrimSpace(req.Model)
	req.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	if req.ReferenceMode != "" && req.ReferenceMode != "auto" && req.ReferenceMode != "none" && req.ReferenceMode != "generations_image" {
		return rewriteModel{}, saveModelError(400, "不支持的参考图协议")
	}
	if req.Name == "" || len(req.Name) > 200 || req.Model == "" || len(req.Model) > 200 {
		return rewriteModel{}, saveModelError(400, "请填写配置名称与模型 ID（不超过 200 字节）")
	}
	if err := adapter.ServiceURL(req.BaseURL, false); err != nil {
		return rewriteModel{}, saveModelError(400, err.Error())
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	models, err := a.modelsFor(capability)
	if err != nil {
		return rewriteModel{}, saveModelError(500, "读取模型配置失败")
	}
	index := -1
	for i := range models {
		if models[i].ID == mid {
			index = i
		}
	}
	if mid != "" && index < 0 {
		return rewriteModel{}, saveModelError(404, "模型配置不存在")
	}
	m := rewriteModel{ID: ID(), Name: req.Name, InputCapability: req.InputCapability, Vision: req.Vision, ReferenceMode: req.ReferenceMode, Service: domain.Service{BaseURL: req.BaseURL, Model: req.Model}}
	if capability == "video" {
		m.Service, err = normalizeVideoService(m.Service)
		if err != nil {
			return rewriteModel{}, saveModelError(400, err.Error())
		}
	}
	if capability != "image" {
		normalizeRewriteVision(&m)
	}
	if index >= 0 {
		m.ID = models[index].ID
		m.Secret = models[index].Secret
	}
	if req.ClearSecret {
		m.Secret = ""
	}
	if req.Secret != "" {
		m.Secret, err = adapter.Seal(req.Secret)
		if err != nil {
			return rewriteModel{}, saveModelError(500, "密钥加密失败")
		}
	}
	if index < 0 {
		models = append(models, m)
	} else {
		models[index] = m
	}
	if err = store.Put(a.Store.DB, "settings", modelsSettingsKey(capability), models); err != nil {
		return rewriteModel{}, saveModelError(500, "保存模型失败")
	}
	return m, nil
}

func (a *App) rewriteModelSave(c *gin.Context) {
	var req modelSaveRequest
	if !bind(c, &req) {
		return
	}
	capability, ok := capabilityFromPath(c.FullPath())
	if !ok {
		fail(c, 404, "模型分组不存在")
		return
	}
	m, err := a.saveModelFor(capability, req, c.Param("mid"))
	if err != nil {
		failModelError(c, err, "保存模型失败")
		return
	}
	c.JSON(200, publicRewriteModel(m))
}

func (a *App) testModelFor(capability, id string) (string, error) {
	models, err := a.modelsFor(capability)
	if err != nil {
		return "", errors.New("读取模型配置失败")
	}
	var svc domain.Service
	found := false
	for _, m := range models {
		if m.ID == id {
			svc = m.Service
			found = true
			break
		}
	}
	if !found {
		return "", errors.New("模型配置不存在")
	}
	if svc.Secret == "" {
		return "", errConfig
	}
	key, err := adapter.Unseal(svc.Secret)
	if err != nil {
		return "", err
	}
	if capability == "video" {
		svc, err = normalizeVideoService(svc)
		if err != nil {
			return "", err
		}
	}
	modelsURL := svc.BaseURL + "/models"
	if capability == "video" && isWanService(svc) {
		modelsURL = strings.TrimSuffix(svc.BaseURL, "/api/v1") + "/compatible-mode/v1/models"
	}
	req, _ := http.NewRequest("GET", modelsURL, bytes.NewReader(nil))
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := (&http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		return "", errors.New("连接失败，请检查服务地址和网络")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", adapter.AIStatusError(res.StatusCode, res.Body, svc.Model)
	}
	var data struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&data)
	for _, m := range data.Data {
		if m.ID == svc.Model {
			return "鉴权通过，已找到模型；实际调用权限以生成结果为准", nil
		}
	}
	return "鉴权通过；模型列表未确认当前模型，需实际调用验证", nil
}

// The service snapshot lives only in backend settings, never in the public job payload.
func (a *App) rewriteJobService(j domain.Job) (domain.Service, error) {
	if asString(j.Payload["model_id"]) == "" {
		return a.settings().Text, nil
	} // old queued jobs
	return store.Get[domain.Service](a.Store.DB, "settings", "rewrite-job-"+j.ID)
}

// Keep an explicit empty catalog so startup migration cannot restore a removed model.
func (a *App) deleteModelFor(capability, id string) (rewriteModel, error) {
	if _, ok := parseModelCapability(capability); !ok {
		return rewriteModel{}, capabilityError()
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	models, err := a.modelsFor(capability)
	if err != nil {
		return rewriteModel{}, saveModelError(500, "读取模型配置失败")
	}
	remaining := []rewriteModel{}
	var removed rewriteModel
	for _, model := range models {
		if model.ID == id {
			removed = model
		} else {
			remaining = append(remaining, model)
		}
	}
	if removed.ID == "" {
		return rewriteModel{}, saveModelError(404, "模型配置不存在")
	}
	if err = store.Put(a.Store.DB, "settings", modelsSettingsKey(capability), remaining); err != nil {
		return rewriteModel{}, saveModelError(500, "删除模型失败")
	}
	return removed, nil
}
