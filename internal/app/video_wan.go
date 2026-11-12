package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
)

var wanWorkspaceHost = regexp.MustCompile(`^[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$`)
var wanPublicHost = regexp.MustCompile(`^dashscope(-[a-z]+)?\.aliyuncs\.com$`)

// Detect only documented official Wan endpoints. Custom providers must not
// inherit a protocol solely from a model's display name. 业务空间域名与百炼
// 公网网关用的是同一套 Wan 协议，区别只在对外开放的模型清单。
func isWanService(s domain.Service) bool {
	u, e := url.Parse(s.BaseURL)
	if e != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return wanWorkspaceHost.MatchString(host) || wanPublicHost.MatchString(host)
}

func normalizeVideoService(s domain.Service) (domain.Service, error) {
	s.BaseURL = strings.TrimRight(strings.TrimSpace(s.BaseURL), "/")
	s.Model = strings.TrimSpace(s.Model)
	if e := adapter.ServiceURL(s.BaseURL, false); e != nil {
		return s, e
	}
	u, _ := url.Parse(s.BaseURL)
	if isWanService(s) {
		if u.Scheme != "https" || (u.Port() != "" && u.Port() != "443") {
			return s, errors.New("万相须使用官方 HTTPS 地址")
		}
		host := strings.ToLower(u.Hostname())
		model := strings.ToLower(s.Model)
		if wanWorkspaceHost.MatchString(host) {
			switch model {
			case "wan3.0-video", "wan3.0-video-prime":
			default:
				return s, errors.New("业务空间目前只开放 wan3.0-video 或 wan3.0-video-prime，请填写准确模型 ID")
			}
		} else if !strings.HasPrefix(model, "wan") {
			return s, errors.New("百炼公网网关的视频模型需以 wan 开头，例如 wanx2.1-t2v-turbo")
		}
		s.Model = model
		switch strings.TrimRight(u.Path, "/") {
		case "", "/compatible-mode/v1", "/api/v1", "/api/v1/services/aigc/video-generation/video-synthesis":
			u.Path = "/api/v1"
			u.RawPath = ""
			s.BaseURL = u.String()
		default:
			return s, errors.New("万相 API 地址应为服务域名加 /api/v1，请勿填写聊天或方舟任务路径")
		}
	} else if strings.HasPrefix(strings.ToLower(s.Model), "wan") || strings.HasSuffix(strings.ToLower(u.Hostname()), ".aliyuncs.com") {
		return s, errors.New("万相请使用 https://dashscope.aliyuncs.com/api/v1 或 https://业务空间ID.地域.maas.aliyuncs.com/api/v1；当前地址不能使用方舟视频协议")
	}
	return s, nil
}

func (a *App) submitVideoTask(svc domain.Service, prompt string, duration int, audio bool) (arkTask, int, error) {
	if isWanService(svc) {
		body := map[string]any{
			"model":      svc.Model,
			"input":      map[string]string{"prompt": prompt},
			"parameters": map[string]any{"duration": duration, "ratio": "9:16", "resolution": "720P", "audio": audio, "prompt_extend": false},
		}
		return a.wanCall(svc, "POST", "/services/aigc/video-generation/video-synthesis", body)
	}
	body := map[string]any{"model": svc.Model, "content": []any{map[string]string{"type": "text", "text": prompt}}, "duration": duration, "ratio": "9:16", "resolution": "720p", "generate_audio": audio}
	return a.arkCall(svc, "POST", "", body)
}

func (a *App) queryVideoTask(svc domain.Service, id string) (arkTask, int, error) {
	if isWanService(svc) {
		return a.wanCall(svc, "GET", "/tasks/"+url.PathEscape(id), nil)
	}
	return a.arkCall(svc, "GET", "/"+url.PathEscape(id), nil)
}

func (a *App) submitReferencedVideoTask(svc domain.Service, prompt string, duration int, audio bool, ratio, resolution, reference string) (arkTask, int, error) {
	if isWanService(svc) {
		body := map[string]any{"model": svc.Model, "input": map[string]any{"prompt": prompt, "media": []any{map[string]string{"type": "reference_video", "url": reference}}}, "parameters": map[string]any{"duration": duration, "ratio": ratio, "resolution": strings.ToUpper(resolution), "audio": audio, "prompt_extend": false}}
		if reference == "" {
			delete(body["input"].(map[string]any), "media")
		}
		return a.wanCall(svc, "POST", "/services/aigc/video-generation/video-synthesis", body)
	}
	body := map[string]any{"model": svc.Model, "content": []any{map[string]string{"type": "text", "text": prompt}, map[string]any{"type": "video_url", "video_url": map[string]string{"url": reference}, "role": "reference_video"}}, "duration": duration, "ratio": ratio, "resolution": resolution, "generate_audio": audio}
	if reference == "" {
		body["content"] = []any{map[string]string{"type": "text", "text": prompt}}
	}
	if reference != "" && strings.HasPrefix(svc.Model, "doubao-seedance-2-5-") {
		body["omni_reference_task_type"] = "reference"
	}
	return a.arkCall(svc, "POST", "", body)
}

// Wan uses output.task_id/task_status, distinct from Ark's id/status contract.
func (a *App) wanCall(svc domain.Service, method, path string, body any) (arkTask, int, error) {
	var task arkTask
	svc, e := normalizeVideoService(svc)
	if e != nil {
		return task, 0, e
	}
	key, e := adapter.Unseal(svc.Secret)
	if e != nil {
		return task, 0, errors.New("万相视频密钥无法读取")
	}
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, e := http.NewRequestWithContext(a.ctx, method, svc.BaseURL+path, reader)
	if e != nil {
		return task, 0, errors.New("万相 API 地址无效")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	if method == "POST" {
		req.Header.Set("X-DashScope-Async", "enable")
	}
	client := &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := client.Do(req)
	if e != nil {
		return task, 0, errors.New("万相视频服务连接中断")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return task, res.StatusCode, adapter.AIStatusError(res.StatusCode, res.Body, svc.Model)
	}
	var response struct {
		Output struct {
			TaskID   string `json:"task_id"`
			Status   string `json:"task_status"`
			VideoURL string `json:"video_url"`
			Code     string `json:"code"`
		} `json:"output"`
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&response); e != nil {
		return task, res.StatusCode, errors.New("万相返回无效任务数据")
	}
	task.ID = response.Output.TaskID
	task.Status = map[string]string{"PENDING": "queued", "RUNNING": "running", "SUCCEEDED": "succeeded", "FAILED": "failed", "CANCELED": "cancelled", "UNKNOWN": "unknown"}[response.Output.Status]
	if task.Status == "" {
		return task, res.StatusCode, errors.New("万相返回未知任务状态，请核实已有任务；未重新提交")
	}
	// Do not echo arbitrary provider strings, even in a field named "code".
	switch response.Output.Code {
	case "InvalidParameter", "DataInspectionFailed", "InvalidApiKey", "AccessDenied", "ModelNotFound", "Throttling", "InternalError", "Arrearage":
		task.FailureCode = response.Output.Code
	}
	task.Content.VideoURL = response.Output.VideoURL
	return task, res.StatusCode, nil
}

func generatedVideoURLForService(raw string, svc domain.Service) error {
	if !isWanService(svc) {
		return generatedVideoURL(raw)
	}
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return errors.New("万相视频下载地址无效")
	}
	// Official result URLs are OSS objects; DNS/private-address checks and
	// redirect validation still run through MediaClient for every download.
	h := strings.ToLower(u.Hostname())
	if !regexp.MustCompile(`^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$`).MatchString(h) {
		return errors.New("视频下载域名不在万相 OSS 结果域名允许列表")
	}
	return nil
}
