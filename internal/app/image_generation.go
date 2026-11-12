package app

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

const maxGeneratedImage = 32 << 20

type imageDownloadReceipt struct {
	JobID string `json:"job_id"`
	URL   string `json:"url"` // Sealed: signed provider URLs never enter API payloads/logs.
}
type generatedImageItem struct {
	Base64 string `json:"b64_json"`
	URL    string `json:"url"`
}

var imageSizePattern = regexp.MustCompile(`^[1-9][0-9]{1,3}x[1-9][0-9]{1,3}$`)

func (a *App) imageModels() ([]rewriteModel, error) {
	models, err := store.Get[[]rewriteModel](a.Store.DB, "settings", "image-models")
	if errors.Is(err, sql.ErrNoRows) {
		return []rewriteModel{}, nil
	}
	for i := range models {
		normalizeImageModel(&models[i])
	}
	return models, err
}

func (a *App) generateImage(c *gin.Context) {
	var req struct {
		Direct       bool                     `json:"direct"`
		RequestID    string                   `json:"request_id"`
		Requirements string                   `json:"requirements"`
		Quality      string                   `json:"quality"`
		Ratio        string                   `json:"ratio"`
		Creative     *domain.CreativeSettings `json:"creative,omitempty"`
		PlanID       string                   `json:"plan_id"`
		ModelID      string                   `json:"model_id"`
		Prompt       string                   `json:"prompt"`
		Size         string                   `json:"size"`
		CopyText     string                   `json:"copy_text"`
		ReferenceIDs []string                 `json:"reference_asset_ids"`
		Count        *int                     `json:"count"`
		Scenes       []string                 `json:"scenes"`
	}
	if !bind(c, &req) {
		return
	}
	if err := validateCreative(req.Creative); err != nil {
		bad(c, err)
		return
	}
	count := 1
	if req.Count != nil {
		count = *req.Count
	}
	if count < 1 || count > 6 {
		fail(c, 400, "请选择生成 1 至 6 张图片")
		return
	}
	if len(req.Scenes) != 0 && len(req.Scenes) != count {
		fail(c, 400, "逐张画面描述数量必须与生成张数一致")
		return
	}
	scenes := make([]string, count)
	for i := range scenes {
		if len(req.Scenes) > 0 {
			scenes[i] = strings.TrimSpace(req.Scenes[i])
		}
		if len([]rune(scenes[i])) > 1000 {
			fail(c, 400, "每张画面描述最多 1000 字")
			return
		}
		if scenes[i] == "" {
			scenes[i] = defaultImageScene(i, count)
		}
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	req.CopyText = strings.TrimSpace(req.CopyText)
	if (!req.Direct && req.Prompt == "" && req.CopyText == "" && len(req.ReferenceIDs) == 0 && strings.TrimSpace(strings.Join(req.Scenes, "")) == "") || len([]rune(req.Prompt)) > 4000 || len([]rune(req.CopyText)) > 12000 {
		fail(c, 400, "请提供画面描述、当前文案或参考图；描述最多 4000 字，文案最多 12000 字")
		return
	}
	if req.Size != "" && !imageSizePattern.MatchString(req.Size) {
		fail(c, 400, "尺寸格式应为宽x高，例如 1024x1024，或留空使用模型默认尺寸")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	var direct *workflowMediaSnapshot
	if req.Direct {
		snapshot, e := a.workflowMediaContext(p, "image", req.ModelID, req.ReferenceIDs, req.Requirements, req.Quality, req.Ratio, count)
		if e != nil {
			bad(c, e)
			return
		}
		direct = &snapshot
		req.Size, e = directImageSize(req.Quality, req.Ratio)
		if e != nil {
			bad(c, e)
			return
		}
		req.Prompt = snapshot.SystemPrompt + "\n补充要求：" + snapshot.Requirements
		w, e := a.readWorkflow(p.ID)
		if e != nil {
			bad(c, e)
			return
		}
		basis, e := a.readWorkflowBasis(p, w)
		if e != nil {
			bad(c, e)
			return
		}
		req.CopyText = basis.Title.Text + "\n" + basis.Copy.Body + "\n" + strings.Join(basis.Copy.Topics, " ")
		if selection := referenceInputFor(w, "image"); selection != nil {
			req.CopyText = selection.text()
		}
		for i := range scenes {
			scenes[i] = fmt.Sprintf("基于原图和新文案创作第%d/%d张完整图片，保持整体视觉一致，构图和细节各有变化。", i+1, count)
		}
	}
	if text := a.workflowCopyText(p.ID); !req.Direct && text != "" {
		req.CopyText = text
	}
	if err := a.validateWorkflowReferences(p, req.ReferenceIDs); err != nil {
		bad(c, err)
		return
	}
	if err := a.workflowRequiresImagePlan(p.ID, req.PlanID, req.Scenes); !req.Direct && err != nil {
		bad(c, err)
		return
	}
	models, err := a.imageModels()
	if err != nil {
		fail(c, 500, "读取图片模型失败")
		return
	}
	var model *rewriteModel
	for i := range models {
		if models[i].ID == req.ModelID {
			model = &models[i]
			break
		}
	}
	if model == nil || model.Secret == "" {
		fail(c, 400, "图片模型待配置，请先添加图片模型并填写密钥")
		return
	}
	if len(req.ReferenceIDs) > 0 && (model.ReferenceLimit == 0 || len(req.ReferenceIDs) > model.ReferenceLimit) {
		fail(c, 400, "当前模型未启用参考图或所选数量超过上限，请查看图片模型配置")
		return
	}
	if !req.Direct && count > 1 && model.ReferenceLimit > 0 && len(req.ReferenceIDs) >= model.ReferenceLimit {
		fail(c, 400, fmt.Sprintf("连续画面需预留 1 张首图参考位，本次最多选择 %d 张来源参考图", model.ReferenceLimit-1))
		return
	}
	refs := []imageReference{}
	seen := map[string]bool{}
	for _, id := range req.ReferenceIDs {
		if seen[id] {
			fail(c, 400, "参考图片重复，请重新选择")
			return
		}
		seen[id] = true
		ref, _, e := a.readImageReference(id, "")
		if e != nil {
			bad(c, e)
			return
		}
		refs = append(refs, ref)
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "读取任务失败")
		return
	}
	fingerprint := ""
	if direct != nil {
		fingerprint = workflowMediaInputFingerprint(*direct)
		if id, e := duplicateMediaRequest(jobs, p.ID, "image_generation", req.RequestID, fingerprint); e != nil {
			fail(c, 409, e.Error())
			return
		} else if id != "" {
			c.JSON(202, gin.H{"job_id": id})
			return
		}
	}
	for _, j := range jobs {
		if j.Target == p.ID && j.Kind == "image_generation" && (j.State == "queued" || j.State == "running") {
			fail(c, 409, "当前项目正在生成图片，请完成后再提交")
			return
		}
	}
	j := newJob("image_generation", p.ID, map[string]any{"model_id": model.ID, "plan_id": req.PlanID, "copy_key": a.workflowCopyKey(p.ID), "model": model.Model, "model_name": model.Name, "prompt": req.Prompt, "size": req.Size})
	if direct != nil {
		j.Payload["direct_media"] = direct
		j.Payload["request_id"] = req.RequestID
		j.Payload["request_input"] = fingerprint
	}
	accountContext, err := a.workflowAccountContext(p.ID)
	if err != nil {
		bad(c, err)
		return
	}
	j.Payload["account_context"] = accountContext
	j.Payload["creative"] = req.Creative
	j.Payload["scenes"] = scenes
	j.Payload["copy_text"] = req.CopyText
	j.Payload["reference_images"] = refs
	j.Payload["reference_mode"] = model.ReferenceMode
	if count > 1 {
		series := imageSeries{Scenes: scenes, AssetIDs: []string{}, Completed: []string{}, ReferenceLimit: model.ReferenceLimit}
		for i := 0; i < count; i++ {
			series.AssetIDs = append(series.AssetIDs, fmt.Sprintf("%s-image-%02d", j.ID, i+1))
		}
		j.Payload["series"] = series
	} else if len(req.Scenes) == 1 && strings.TrimSpace(req.Scenes[0]) != "" {
		j.Payload["prompt"] = req.Prompt + "\n本张画面：" + req.Scenes[0]
	}
	var directWorkflow creationWorkflow
	if direct != nil {
		directWorkflow, err = a.readWorkflow(p.ID)
		if err != nil {
			bad(c, err)
			return
		}
	}
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		if direct != nil {
			if e := store.Put(tx, "creation_workflows", p.ID, directWorkflow); e != nil {
				return e
			}
		}
		if err := store.Put(tx, "settings", "image-job-"+j.ID, model.Service); err != nil {
			return err
		}
		return store.Put(tx, "jobs", j.ID, j)
	})
	if err != nil {
		fail(c, 500, "创建图片任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}

// Restrict image URLs to known media CDNs or the configured provider, then let
// MediaClient validate DNS and the connected IP. Never forward API credentials.
func generatedImageURL(raw, base string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return errors.New("生成图片下载地址不安全")
	}
	s, err := url.Parse(base)
	if err != nil {
		return errors.New("图片服务地址无效")
	}
	h := strings.ToLower(u.Hostname())
	if strings.EqualFold(h, s.Hostname()) || h == "blob.core.windows.net" || strings.HasSuffix(h, ".blob.core.windows.net") || adapter.AllowedURL(raw) == nil {
		return nil
	}
	return errors.New("图片下载域名不在允许列表，请使用返回 Base64 图片的模型接口")
}

func (a *App) runImageFrame(j domain.Job, assetID, suffix string) (string, error) {
	return a.runImageFrameWithClient(j, assetID, suffix, adapter.MediaClient())
}

func (a *App) runImageFrameWithClient(j domain.Job, assetID, suffix string, download *http.Client) (string, error) {
	// A completed local result is reusable after a crash; do not pay twice.
	if v, err := store.Get[domain.Asset](a.Store.DB, "assets", assetID); err == nil {
		f, e := a.openMedia(v.Path)
		if e != nil {
			return "", errors.New("已生成图片的本地文件丢失，请恢复文件；未重新调用模型")
		}
		f.Close()
		return v.ID, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	p, err := store.Get[domain.Project](a.Store.DB, "projects", j.Target)
	if err != nil || p.DeletedAt != "" {
		return "", errors.New("仿写项目不存在或已在回收站")
	}
	svc, err := store.Get[domain.Service](a.Store.DB, "settings", "image-job-"+j.ID)
	if err != nil {
		return "", errors.New("缺少图片任务的模型配置，请重新提交")
	}
	item := generatedImageItem{}
	receipt, receiptErr := store.Get[imageDownloadReceipt](a.Store.DB, "settings", "image-result-"+assetID)
	if receiptErr == nil {
		if receipt.JobID != j.ID {
			return "", errors.New("图片下载记录与任务不匹配")
		}
		item.URL, err = adapter.Unseal(receipt.URL)
		if err != nil || item.URL == "" {
			return "", errors.New("已生成图片下载记录无法读取，未重新调用模型")
		}
	} else if !errors.Is(receiptErr, sql.ErrNoRows) {
		return "", receiptErr
	}
	if item.URL == "" {
		if svc.Secret == "" {
			return "", errConfig
		}
		key, err := adapter.Unseal(svc.Secret)
		if err != nil {
			return "", errors.New("图片模型密钥无法读取")
		}
		body := map[string]any{"model": svc.Model, "prompt": asString(j.Payload["prompt"]), "n": 1}
		refs, err := jobImageReferences(j)
		if err != nil {
			return "", err
		}
		var images []string
		if len(refs) > 0 {
			if asString(j.Payload["reference_mode"]) != "generations_image" {
				return "", errors.New("任务未配置参考图协议，请重新提交")
			}
			images = []string{}
			for _, ref := range refs {
				_, data, e := a.readImageReference(ref.ID, ref.SHA256)
				if e != nil {
					return "", e
				}
				images = append(images, data)
			}
			body["image"] = images
		}
		if copyText := asString(j.Payload["copy_text"]); copyText != "" || len(refs) > 0 {
			body["prompt"] = imagePrompt(asString(j.Payload["prompt"]), copyText, len(refs))
		}
		if creative := jobCreative(j); creative != nil {
			body["prompt"] = asString(body["prompt"]) + creativePrompt(creative, "image")
		}
		body["prompt"] = asString(body["prompt"]) + asString(j.Payload["account_context"])
		if suffix != "" {
			body["prompt"] = asString(body["prompt"]) + "\n\n" + suffix
		}
		if size := asString(j.Payload["size"]); size != "" {
			body["size"] = size
		}
		// 百炼公网网关走原生多模态协议，其余供应商沿用 OpenAI 兼容的
		// /images/generations。两者请求体与响应结构都不同，必须在同处分支。
		dashscope := isDashscopeService(svc.BaseURL)
		endpoint := strings.TrimRight(svc.BaseURL, "/") + "/images/generations"
		payload := body
		if dashscope {
			endpoint = dashscopeImageEndpoint(svc.BaseURL)
			payload = dashscopeImageBody(svc.Model, asString(body["prompt"]), images, asString(body["size"]))
			if endpoint == "" {
				return "", errors.New("图片服务地址无效")
			}
		}
		encoded, _ := json.Marshal(payload)
		req, err := http.NewRequestWithContext(a.ctx, "POST", endpoint, bytes.NewReader(encoded))
		if err != nil {
			return "", errors.New("图片服务地址无效")
		}
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		res, err := client.Do(req)
		if err != nil {
			return "", errors.New("图片生成连接中断，结果不明；请核实服务商记录后再手动重试，可能再次计费")
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			switch res.StatusCode {
			case 401, 403:
				return "", errors.New("图片模型鉴权失败或无权限，请检查 API 密钥及模型权限")
			case 429:
				return "", errors.New("图片模型请求限流，请稍后手动重试")
			case 400, 422:
				return "", errors.New("图片模型不接受当前参数，请检查模型 ID、画面描述及尺寸")
			}
			return "", errors.New("图片生成服务返回异常，请检查配置和服务商记录后手动重试")
		}
		raw, err := io.ReadAll(io.LimitReader(res.Body, maxGeneratedImage*2+1))
		if err != nil || len(raw) > maxGeneratedImage*2 {
			return "", errors.New("图片响应读取失败或超过限制，请核实服务商记录后再重试")
		}
		if dashscope {
			item, err = dashscopeImageResult(raw)
			if err != nil {
				return "", errors.New("模型未返回一张有效图片，请检查图片模型 ID 与画面参数")
			}
		} else {
			var response struct {
				Data []generatedImageItem `json:"data"`
			}
			if json.Unmarshal(raw, &response) != nil || len(response.Data) != 1 {
				return "", errors.New("模型未返回一张有效图片，请使用兼容 Images Generations 的图片接口")
			}
			item = response.Data[0]
		}
		if item.Base64 == "" && item.URL != "" {
			sealed, e := adapter.Seal(item.URL)
			if e != nil {
				return "", errors.New("图片已生成但下载记录保存失败，请核实服务商结果")
			}
			if e = store.Put(a.Store.DB, "settings", "image-result-"+assetID, imageDownloadReceipt{JobID: j.ID, URL: sealed}); e != nil {
				return "", errors.New("图片已生成但下载记录保存失败，请核实服务商结果")
			}
		}
	}
	var data []byte
	if item.Base64 != "" {
		data, err = base64.StdEncoding.DecodeString(item.Base64)
		if err != nil {
			return "", errors.New("模型返回的图片编码无效")
		}
	} else if item.URL != "" {
		if err = generatedImageURL(item.URL, svc.BaseURL); err != nil {
			return "", err
		}
		download.CheckRedirect = func(r *http.Request, via []*http.Request) error {
			if len(via) > 5 {
				return errors.New("图片重定向过多")
			}
			return generatedImageURL(r.URL.String(), svc.BaseURL)
		}
		r, _ := http.NewRequestWithContext(a.ctx, "GET", item.URL, nil)
		out, e := download.Do(r)
		if e != nil {
			return "", errors.New("图片已生成，下载失败；重试仅下载已生成图片，不会重新调用模型")
		}
		defer out.Body.Close()
		if out.StatusCode != 200 {
			return "", errors.New("已生成图片下载被拒绝或地址过期；重试仅下载，地址失效时请从服务商取回素材")
		}
		data, err = io.ReadAll(io.LimitReader(out.Body, maxGeneratedImage+1))
	} else {
		return "", errors.New("图片模型未返回图片数据")
	}
	if err != nil || len(data) > maxGeneratedImage {
		return "", errors.New("生成图片读取失败或超过 32 MB")
	}
	name := "生成图片"
	if assetID != j.ID {
		name = fmt.Sprintf("图片 %s", strings.TrimPrefix(assetID, j.ID+"-image-"))
	}
	v := domain.Asset{ID: assetID, Name: name, Kind: "image", Source: "generated", ProjectID: p.ID, ProjectName: p.Name, LibraryState: "result", Category: "AI 生成", CreatedAt: Now()}
	if err = a.ingest(bytes.NewReader(data), &v); err != nil {
		return "", err
	}
	a.mu.Lock()
	err = store.Put(a.Store.DB, "assets", v.ID, v)
	a.mu.Unlock()
	if err != nil {
		os.Remove(filepath.Join(a.Config.DataDir, "media", v.Path))
		return "", errors.New("生成图片保存失败")
	}
	return v.ID, nil
}
