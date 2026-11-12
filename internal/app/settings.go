package app

import (
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"os/exec"
	"strings"
	"time"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) settings() domain.Settings {
	s, e := store.Get[domain.Settings](a.Store.DB, "settings", "services")
	if e == nil {
		return s
	}
	return domain.Settings{Text: domain.Service{BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", Model: "qwen-plus"}, OCR: domain.Service{BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", Model: "qwen3.5-ocr"}, ASR: domain.Service{BaseURL: "wss://dashscope.aliyuncs.com/api-ws/v1/inference", Model: "paraformer-realtime-v2"}, CollectorURL: a.Config.CollectorURL}
}
func (a *App) settingsGet(c *gin.Context) {
	s := a.settings()
	for _, v := range []*domain.Service{&s.Text, &s.OCR, &s.ASR} {
		v.Configured = v.Secret != ""
		if v.Configured {
			v.Mask = "••••••••"
		}
		v.Secret = ""
	}
	_, fe := exec.LookPath("ffmpeg")
	_, pe := exec.LookPath("ffprobe")
	c.JSON(200, gin.H{"services": s, "dependencies": gin.H{"ffmpeg": fe == nil, "ffprobe": pe == nil}, "data_dir": a.Config.DataDir})
}
func (a *App) settingsPut(c *gin.Context) {
	var req struct {
		Text  *domain.Service `json:"text"`
		OCR   *domain.Service `json:"ocr"`
		ASR   *domain.Service `json:"asr"`
		Clear []string        `json:"clear"`
	}
	if !bind(c, &req) {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s := a.settings()
	targets := []*domain.Service{&s.Text, &s.OCR, &s.ASR}
	incoming := []*domain.Service{req.Text, req.OCR, req.ASR}
	names := []string{"text", "ocr", "asr"}
	for i, v := range incoming {
		// Partial submissions update only the selected service. Omitted services
		// and blank secrets retain their existing encrypted configuration.
		if v != nil && !(i == 0 && v.BaseURL == "") {
			if e := adapter.ServiceURL(v.BaseURL, i == 2); e != nil {
				bad(c, e)
				return
			}
			targets[i].BaseURL = strings.TrimRight(v.BaseURL, "/")
			targets[i].Model = strings.TrimSpace(v.Model)
			if v.Secret != "" {
				enc, e := adapter.Seal(v.Secret)
				if e != nil {
					bad(c, e)
					return
				}
				targets[i].Secret = enc
			}
		}
		for _, k := range req.Clear {
			if k == names[i] {
				targets[i].Secret = ""
			}
		}
	}
	s.CollectorURL = a.Config.CollectorURL
	if e := store.Put(a.Store.DB, "settings", "services", s); e != nil {
		fail(c, 500, "保存配置失败")
		return
	}
	c.JSON(200, gin.H{"saved": true})
}
func (a *App) settingsTest(c *gin.Context) {
	s := a.settings()
	kind := c.Param("service")
	if kind == "collector" {
		req, _ := http.NewRequestWithContext(c.Request.Context(), "GET", s.CollectorURL+"/health", nil)
		req.Header.Set("X-Collector-Token", a.CollectorToken)
		res, e := (&http.Client{Timeout: 5 * time.Second}).Do(req)
		if e != nil {
			fail(c, 503, "采集服务未启动，请运行启动脚本")
			return
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			bad(c, adapter.StatusError(res.StatusCode))
			return
		}
		c.JSON(200, gin.H{"message": "采集服务连接正常"})
		return
	}
	// 单条模型配置的检测与后台共用 testModelFor：同一份配置从工作台还是从管理
	// 控制台发起，必须得到同一结论，否则用户会看到「后台通过、前台失败」。
	if id := c.Param("mid"); id != "" {
		capability, ok := capabilityFromPath(c.FullPath())
		if !ok {
			fail(c, 404, "模型分组不存在")
			return
		}
		message, err := a.testModelFor(capability, id)
		if err != nil {
			bad(c, err)
			return
		}
		c.JSON(200, gin.H{"message": message})
		return
	}
	svc := s.Text
	switch kind {
	case "ocr":
		svc = s.OCR
	case "asr":
		svc = s.ASR
	case "text":
	default:
		fail(c, 400, "未知服务")
		return
	}
	if svc.Secret == "" {
		bad(c, errConfig)
		return
	}
	if kind == "asr" {
		if e := a.checkASR(c.Request.Context(), svc); e != nil {
			bad(c, e)
			return
		}
		c.JSON(200, gin.H{"message": "WebSocket 握手成功；模型识别能力需使用音频验证"})
		return
	}
	key, e := adapter.Unseal(svc.Secret)
	if e != nil {
		bad(c, e)
		return
	}
	modelsURL := svc.BaseURL + "/models"
	req, _ := http.NewRequestWithContext(c.Request.Context(), "GET", modelsURL, bytes.NewReader(nil))
	req.Header.Set("Authorization", "Bearer "+key)
	res, e := (&http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if e != nil {
		fail(c, 502, "连接失败，请检查服务地址和网络")
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		bad(c, adapter.AIStatusError(res.StatusCode, res.Body, svc.Model))
		return
	}
	var data struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	json.NewDecoder(res.Body).Decode(&data)
	found := false
	for _, m := range data.Data {
		if m.ID == svc.Model {
			found = true
		}
	}
	msg := "鉴权通过；模型列表未确认当前模型，需实际调用验证"
	if found {
		msg = "鉴权通过，已找到模型；实际调用权限以生成结果为准"
	}
	c.JSON(200, gin.H{"message": msg})
}
