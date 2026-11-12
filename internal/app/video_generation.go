package app

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

var errVideoUnknown = errors.New("镜头提交结果不明，已暂停；请在所选视频服务商核实任务 ID 后关联，禁止直接重试创建付费任务")
var videoRemoteID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)

type videoClip struct {
	RemoteID string `json:"remote_id,omitempty"`
	State    string `json:"state"`
	AssetID  string `json:"asset_id,omitempty"`
}
type videoProduction struct {
	ScriptID string      `json:"script_id"`
	Audio    bool        `json:"audio"`
	Shots    []videoClip `json:"shots"`
}

func videoCanResume(j domain.Job) bool {
	var p videoProduction
	if decodeVideoPayload(j, "production", &p) != nil || len(p.Shots) == 0 {
		return false
	}
	for _, s := range p.Shots {
		if s.State == "submitting" && s.RemoteID == "" {
			return false
		}
	}
	return true
}
func (a *App) generateVideo(c *gin.Context) {
	var req struct {
		Prompt        string `json:"prompt"`
		ScriptID      string `json:"script_id"`
		ModelID       string `json:"model_id"`
		Audio         bool   `json:"audio"`
		PreviousJobID string `json:"previous_job_id"`
		RedoShot      *int   `json:"redo_shot"`
		RequestID     string `json:"request_id"`
	}
	if !bind(c, &req) {
		return
	}
	if len([]rune(req.Prompt)) > 4000 {
		fail(c, 400, "视频生成提示词最多4000字")
		return
	}
	if req.PreviousJobID != "" && !videoRemoteID.MatchString(req.RequestID) {
		fail(c, 400, "新制作版本需要有效请求编号")
		return
	}
	if req.RedoShot != nil && req.PreviousJobID == "" {
		fail(c, 400, "请选择原制作版本")
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
	s, e := store.Get[videoScript](a.Store.DB, "video_scripts", req.ScriptID)
	if e != nil || s.ProjectID != p.ID {
		fail(c, 400, "请选择本项目的完整脚本")
		return
	}
	if key := a.workflowCopyKey(p.ID); key != "" && s.Brief.CopyKey != key {
		fail(c, 409, "文案已变化，请重新确认脚本")
		return
	}
	if s.CancelledAt != "" {
		fail(c, 409, "脚本已取消，请重新规划")
		return
	}
	if s.ConfirmedAt == "" {
		fail(c, 409, "请先确认完整脚本，再生成视频")
		return
	}
	if e = validateVideoScript(s); e != nil {
		bad(c, e)
		return
	}
	models, e := a.videoModels()
	if e != nil {
		bad(c, e)
		return
	}
	var m *rewriteModel
	for i := range models {
		if models[i].ID == req.ModelID {
			m = &models[i]
		}
	}
	if m == nil || m.Secret == "" {
		fail(c, 400, "视频模型待配置，请填写视频服务 API 地址、模型和密钥")
		return
	}
	m.Service, e = normalizeVideoService(m.Service)
	if e != nil {
		bad(c, e)
		return
	}
	if e = validateContinuousVideo(s, m.Service); e != nil {
		bad(c, e)
		return
	}
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		bad(c, e)
		return
	}
	fingerprint, _ := json.Marshal(req)
	for _, j := range jobs {
		if j.Target == p.ID && j.Kind == "video_generate" && req.RequestID != "" && asString(j.Payload["request_id"]) == req.RequestID {
			if asString(j.Payload["request_input"]) != string(fingerprint) {
				fail(c, 409, "请求编号已用于其他制作，请刷新后重试")
				return
			}
			c.JSON(202, gin.H{"job_id": j.ID})
			return
		}
	}
	for _, j := range jobs {
		if j.Target != p.ID || j.Kind != "video_generate" {
			continue
		}
		var prev videoProduction
		_ = decodeVideoPayload(j, "production", &prev)
		if prev.ScriptID == s.ID && req.PreviousJobID == "" {
			c.JSON(202, gin.H{"job_id": j.ID})
			return
		}
		if j.State == "queued" || j.State == "running" {
			fail(c, 409, "当前项目正在制作视频，请完成后再提交")
			return
		}
		if req.PreviousJobID != "" {
			for _, shot := range prev.Shots {
				if !videoClipSettled(shot) {
					fail(c, 409, "已有镜头仍在处理、待下载或提交结果不明，请先继续查询或关联任务")
					return
				}
			}
		}
	}
	prod := videoProduction{ScriptID: s.ID, Audio: req.Audio, Shots: make([]videoClip, len(s.Shots))}
	for i := range prod.Shots {
		prod.Shots[i].State = "pending"
	}
	if req.PreviousJobID != "" {
		old, err := store.Get[domain.Job](a.Store.DB, "jobs", req.PreviousJobID)
		var prev videoProduction
		if err != nil || old.Target != p.ID || old.Kind != "video_generate" || decodeVideoPayload(old, "production", &prev) != nil || prev.ScriptID != s.ID || len(prev.Shots) != len(prod.Shots) {
			fail(c, 400, "原制作版本与当前脚本不匹配")
			return
		}
		if req.RedoShot != nil {
			if *req.RedoShot < 0 || *req.RedoShot >= len(prod.Shots) {
				fail(c, 400, "镜头编号无效")
				return
			}
			if req.Audio != prev.Audio {
				fail(c, 409, "单镜重做须保持原制作版本的声音选项；更改声音请新建整组制作")
				return
			}
			for i, shot := range prev.Shots {
				if i == *req.RedoShot {
					continue
				}
				if shot.State == "succeeded" && shot.AssetID != "" {
					prod.Shots[i] = shot
				} else if shot.State != "pending" {
					fail(c, 409, "其他镜头也未完成，请选择新建整组制作")
					return
				}
			}
		}
	}
	j := newJob("video_generate", p.ID, map[string]any{"production": prod, "prompt": req.Prompt, "model": m.Model, "model_name": m.Name, "previous_job_id": req.PreviousJobID, "request_id": req.RequestID, "request_input": string(fingerprint)})
	accountContext, e := a.workflowAccountContext(p.ID)
	if e != nil {
		bad(c, e)
		return
	}
	j.Payload["account_context"] = accountContext
	e = a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "settings", "video-job-"+j.ID, m.Service); e != nil {
			return e
		}
		return store.Put(tx, "jobs", j.ID, j)
	})
	if e != nil {
		bad(c, e)
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}

func videoClipSettled(s videoClip) bool {
	if s.State == "succeeded" {
		return s.AssetID != ""
	}
	switch s.State {
	case "pending", "rejected", "failed", "cancelled", "expired":
		return true
	}
	return false
}
func (a *App) saveVideoProgress(id string, p videoProduction, stage string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	j, e := store.Get[domain.Job](a.Store.DB, "jobs", id)
	if e != nil {
		return e
	}
	j.Payload["production"] = p
	j.Stage = stage
	j.UpdatedAt = Now()
	return store.Put(a.Store.DB, "jobs", id, j)
}
func (a *App) linkVideoTask(c *gin.Context) {
	var req struct {
		Shot     int    `json:"shot"`
		RemoteID string `json:"remote_id"`
	}
	if !bind(c, &req) {
		return
	}
	if !videoRemoteID.MatchString(req.RemoteID) {
		fail(c, 400, "远程任务 ID 无效")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.editableProject(c, c.Param("id")); !ok {
		return
	}
	j, ok := get[domain.Job](a, c, "jobs", c.Param("jid"))
	if !ok {
		return
	}
	var p videoProduction
	if j.Target != c.Param("id") || j.Kind != "video_generate" || j.State == "running" || j.State == "queued" || decodeVideoPayload(j, "production", &p) != nil || req.Shot < 0 || req.Shot >= len(p.Shots) {
		fail(c, 409, "任务不可关联")
		return
	}
	shot := &p.Shots[req.Shot]
	if shot.State != "submitting" || shot.RemoteID != "" {
		fail(c, 409, "仅提交结果不明的镜头可关联远程任务")
		return
	}
	for _, v := range p.Shots {
		if v.RemoteID == req.RemoteID {
			fail(c, 409, "该远程任务已关联另一个镜头")
			return
		}
	}
	shot.RemoteID = req.RemoteID
	j.Payload["production"] = p
	j.State = "queued"
	j.Error = ""
	j.UpdatedAt = Now()
	if e := store.Put(a.Store.DB, "jobs", j.ID, j); e != nil {
		bad(c, e)
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}

type arkTask struct {
	FailureCode string `json:"-"`
	ID          string `json:"id"`
	Model       string `json:"model"`
	Status      string `json:"status"`
	Content     struct {
		VideoURL string `json:"video_url"`
	} `json:"content"`
}

func (a *App) arkCall(svc domain.Service, method, path string, body any) (arkTask, int, error) {
	var out arkTask
	if e := adapter.ServiceURL(svc.BaseURL, false); e != nil {
		return out, 0, e
	}
	key, e := adapter.Unseal(svc.Secret)
	if e != nil {
		return out, 0, errors.New("视频密钥无法读取")
	}
	var reader io.Reader
	if method != "GET" {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(a.ctx, method, strings.TrimRight(svc.BaseURL, "/")+"/contents/generations/tasks"+path, reader)
	if e != nil {
		return out, 0, errors.New("视频 API 地址无效")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := client.Do(req)
	if e != nil {
		return out, 0, errors.New("视频服务连接中断")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return out, res.StatusCode, adapter.AIStatusError(res.StatusCode, res.Body, svc.Model)
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out); e != nil {
		return out, res.StatusCode, errors.New("视频服务返回无效任务数据")
	}
	return out, res.StatusCode, nil
}
func generatedVideoURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return errors.New("视频下载地址无效")
	}
	h := strings.ToLower(u.Hostname())
	if !strings.HasSuffix(h, ".volces.com") && !strings.HasSuffix(h, ".volccdn.com") {
		return errors.New("视频下载域名不在火山方舟允许列表")
	}
	return nil
}
func (a *App) downloadVideo(raw, id string, svc domain.Service) (domain.Asset, error) {
	v := domain.Asset{ID: id, Name: "AI 视频镜头", Kind: "video", Source: "generated", LibraryState: "result", Category: "AI 视频", CreatedAt: Now()}
	if e := generatedVideoURLForService(raw, svc); e != nil {
		return v, e
	}
	client := adapter.MediaClient()
	client.CheckRedirect = func(r *http.Request, via []*http.Request) error {
		if len(via) > 5 {
			return errors.New("视频重定向过多")
		}
		return generatedVideoURLForService(r.URL.String(), svc)
	}
	req, _ := http.NewRequestWithContext(a.ctx, "GET", raw, nil)
	res, e := client.Do(req)
	if e != nil {
		return v, errors.New("生成视频下载失败，重试将查询同一任务，不会重新生成")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return v, errors.New("生成视频地址失效或下载被拒绝，请稍后重试查询")
	}
	e = a.ingest(res.Body, &v)
	return v, e
}
func (a *App) runVideoGenerate(j domain.Job) (string, error) {
	direct := mediaSnapshot(j)
	var p videoProduction
	if decodeVideoPayload(j, "production", &p) != nil || len(p.Shots) == 0 {
		return "", errors.New("视频制作记录无效")
	}
	s, e := store.Get[videoScript](a.Store.DB, "video_scripts", p.ScriptID)
	if e != nil {
		return "", e
	}
	if s.ConfirmedAt == "" || len(s.Shots) != len(p.Shots) {
		return "", errors.New("脚本未确认或分镜不完整")
	}
	svc, e := store.Get[domain.Service](a.Store.DB, "settings", "video-job-"+j.ID)
	if e != nil {
		return "", e
	}
	svc, e = normalizeVideoService(svc)
	if e != nil {
		return "", e
	}
	if e = validateContinuousVideo(s, svc); direct == nil && e != nil {
		return "", e
	}
	for i := range p.Shots {
		shot := &p.Shots[i]
		assetID := fmt.Sprintf("%s-shot-%02d", j.ID, i+1)
		if shot.AssetID != "" {
			assetID = shot.AssetID
		}
		if v, e := store.Get[domain.Asset](a.Store.DB, "assets", assetID); e == nil && v.Status == "ready" {
			if _, e = a.mediaPath(v.Path); e != nil {
				return "", errors.New("已生成镜头文件丢失，请恢复本地文件")
			}
			shot.AssetID = v.ID
			shot.State = "succeeded"
			continue
		}
		if shot.AssetID != "" {
			return "", errors.New("复用镜头文件不可用，请恢复素材；未重新调用模型")
		}
		if shot.RemoteID == "" {
			if shot.State == "submitting" {
				return "", errVideoUnknown
			}
			if _, e = adapter.Unseal(svc.Secret); e != nil {
				return "", errors.New("视频密钥无法读取")
			}
			if e = adapter.ServiceURL(svc.BaseURL, false); e != nil {
				return "", e
			}
			scene := s.Shots[i]
			prompt := videoScenePrompt(s, i) + "\n视频生成补充要求：" + asString(j.Payload["prompt"]) + asString(j.Payload["account_context"])
			referenceURL := ""
			if direct != nil {
				if len(direct.SourceIDs) > 0 {
					referenceURL, e = a.directVideoReference(j, *direct)
					if e != nil {
						return "", e
					}
				}
				prompt = direct.SystemPrompt + "\n用户补充要求：" + direct.Requirements
				if len(direct.SourceIDs) > 0 {
					prompt += asString(j.Payload["account_context"])
				}
				if direct.Script != "" {
					prompt += "\n视频脚本（按时间顺序执行）：\n" + direct.Script
				}
				if len(p.Shots) > 1 {
					prompt += fmt.Sprintf("\n本次生成第%d/%d个独立版本。", i+1, len(p.Shots))
				}
			}
			shot.State = "submitting"
			if e = a.saveVideoProgress(j.ID, p, "提交"+videoPartLabel(s, i)); e != nil {
				return "", e
			}
			var task arkTask
			var status int
			var err error
			if direct != nil {
				task, status, err = a.submitReferencedVideoTask(svc, prompt, scene.Duration, p.Audio, direct.Ratio, direct.Quality, referenceURL)
			} else {
				task, status, err = a.submitVideoTask(svc, prompt, scene.Duration, p.Audio)
			}
			if err != nil {
				// Only explicit validation/auth/rate-limit rejections establish that no task was accepted.
				if status == 400 || status == 401 || status == 403 || status == 404 || status == 422 || status == 429 {
					shot.State = "rejected"
					if e = a.saveVideoProgress(j.ID, p, videoPartLabel(s, i)+"提交被拒绝"); e != nil {
						return "", e
					}
					return "", err
				}
				return "", errVideoUnknown
			}
			if !videoRemoteID.MatchString(task.ID) {
				return "", errVideoUnknown
			}
			shot.RemoteID = task.ID
			shot.State = "queued"
			if e = a.saveVideoProgress(j.ID, p, "已保存远程任务，等待生成"); e != nil {
				return "", errVideoUnknown
			}
		}
		deadline := time.Now().Add(30 * time.Minute)
		for {
			task, _, err := a.queryVideoTask(svc, shot.RemoteID)
			if err != nil {
				return "", err
			}
			if task.ID != shot.RemoteID || (task.Model != "" && task.Model != svc.Model) {
				return "", errors.New("远程任务身份或模型不匹配，请核实关联的任务")
			}
			shot.State = task.Status
			if e = a.saveVideoProgress(j.ID, p, videoPartLabel(s, i)+"："+task.Status); e != nil {
				return "", e
			}
			switch task.Status {
			case "succeeded":
				if e = a.saveVideoProgress(j.ID, p, "视频生成完成，正在缓存生成结果供预览"); e != nil {
					return "", e
				}
				v, err := a.downloadVideo(task.Content.VideoURL, assetID, svc)
				if err != nil {
					return "", fmt.Errorf("视频已生成，结果缓存失败，可重试下载而无需重新生成：%w", err)
				}
				a.tagVideoAsset(&v, s)
				v.Name = fmt.Sprintf("视频 %d", i+1)
				if s.Brief.Mode == "continuous" {
					v.Name = fmt.Sprintf("视频 · %d秒", s.Brief.Duration)
				}
				shot.AssetID = v.ID
				a.mu.Lock()
				current, err := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
				if err == nil {
					current.Payload["production"] = p
					current.UpdatedAt = Now()
					err = a.Store.Transaction(func(tx *sql.Tx) error {
						if e := store.Put(tx, "assets", v.ID, v); e != nil {
							return e
						}
						return store.Put(tx, "jobs", j.ID, current)
					})
				}
				a.mu.Unlock()
				if err != nil {
					return "", fmt.Errorf("视频已下载，结果登记失败，可重试保存：%w", err)
				}
			case "failed", "cancelled", "expired":
				if s.Brief.Mode == "continuous" {
					return "", fmt.Errorf("完整视频远程任务 %s（错误码：%s）；请核实服务商任务记录后选择重新生成完整视频", task.Status, task.FailureCode)
				}
				if task.FailureCode != "" {
					return "", fmt.Errorf("第 %d 镜远程任务 %s，错误码 %s；其他结果已保留，请核实服务商任务记录", i+1, task.Status, task.FailureCode)
				}
				return "", fmt.Errorf("第 %d 镜远程任务 %s；其余结果已保留，可选择重做此镜并继续，或新建整组制作", i+1, task.Status)
			case "queued", "running":
				if time.Now().After(deadline) {
					return "", errors.New("视频仍在云端处理中，可重试继续查询同一任务")
				}
				select {
				case <-a.ctx.Done():
					return "", a.ctx.Err()
				case <-time.After(15 * time.Second):
				}
				continue
			default:
				return "", errors.New("视频服务返回未知状态，已暂停查询")
			}
			break
		}
	}
	stage := "全部镜头已保存，请预览后合成"
	if s.Brief.Mode == "continuous" {
		stage = "完整视频已保存，请预览后制作成片"
	}
	if e = a.saveVideoProgress(j.ID, p, stage); e != nil {
		return "", e
	}
	return j.ID, nil
}
