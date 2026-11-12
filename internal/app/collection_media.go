package app

import (
	"context"
	"database/sql"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Remote collection entries describe available media, not files in the library.
func (a *App) listAssets(c *gin.Context) {
	all, err := store.List[domain.Asset](a.Store.DB, "assets")
	if err != nil {
		fail(c, 500, "读取素材失败")
		return
	}
	items := []domain.Asset{}
	names, err := assetPresentations(a.Store.DB)
	if err != nil {
		fail(c, 500, "读取素材名称失败")
		return
	}
	for _, asset := range all {
		if c.Query("include_remote") != "true" && asset.LibraryState == "collected" {
			continue
		}
		if c.Query("include_results") != "true" && asset.LibraryState == "result" {
			continue
		}
		if c.Query("include_remote") != "true" && asset.Source == "collection" && asset.Status != "ready" {
			continue
		}
		items = append(items, names[asset.ID])
	}
	c.JSON(200, items)
}

func (a *App) downloadCollectionMedia(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 100 {
		fail(c, 400, "请选择 1 至 100 份图片或视频")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	note, ok := get[domain.Note](a, c, "notes", c.Param("id"))
	if !ok {
		return
	}
	if note.DeletedAt != "" {
		fail(c, 409, "请先恢复笔记再下载素材")
		return
	}
	assets := []domain.Asset{}
	seen := map[string]bool{}
	for _, id := range req.IDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		v, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if err != nil || v.Source != "collection" || v.DeletedAt != "" {
			fail(c, 400, "所选素材不存在或已被删除")
			return
		}
		r, err := store.Get[domain.Revision](a.Store.DB, "revisions", v.RevisionID)
		belongs := false
		for _, assetID := range r.AssetIDs {
			if assetID == id {
				belongs = true
			}
		}
		if err != nil || r.NoteID != note.ID || !belongs {
			fail(c, 400, "所选素材不属于这篇笔记")
			return
		}
		if v.Status == "ready" {
			continue
		}
		if err := adapter.AllowedURL(v.RemoteURL); err != nil {
			fail(c, 400, "素材地址不可用，请重新采集笔记")
			return
		}
		assets = append(assets, v)
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "读取下载任务失败")
		return
	}
	active := map[string]domain.Job{}
	for _, j := range jobs {
		if j.Kind == "download" && (j.State == "queued" || j.State == "running") {
			active[j.Target] = j
		}
	}
	jobIDs := []string{}
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		for _, v := range assets {
			j, exists := active[v.ID]
			if !exists {
				j = newJob("download", v.ID, map[string]any{})
			}
			if j.Payload == nil {
				j.Payload = map[string]any{}
			}
			j.Payload["trigger"] = "collection_auto"
			if err := store.Put(tx, "jobs", j.ID, j); err != nil {
				return err
			}
			if v.LibraryState == "" {
				v.LibraryState = "collected"
			}
			v.Status, v.Error = "pending", ""
			if err := store.Put(tx, "assets", v.ID, v); err != nil {
				return err
			}
			jobIDs = append(jobIDs, j.ID)
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "保存下载任务失败")
		return
	}
	c.JSON(202, gin.H{"job_ids": jobIDs, "count": len(jobIDs)})
}

var previewRange = regexp.MustCompile(`^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$`)

func (a *App) previewCollectionMedia(c *gin.Context) {
	a.previewCollectionMediaWithClient(c, adapter.MediaClient())
}

// Stream a preview only. Never ingest it or create download / extraction jobs.
func (a *App) previewCollectionMediaWithClient(c *gin.Context, client *http.Client) {
	v, ok := get[domain.Asset](a, c, "assets", c.Param("id"))
	if !ok {
		return
	}
	if v.DeletedAt != "" {
		fail(c, 404, "素材已删除")
		return
	}
	if v.Status == "ready" {
		a.assetFile(c)
		return
	}
	if v.Source != "collection" {
		fail(c, 409, "素材尚未就绪")
		return
	}
	r, err := store.Get[domain.Revision](a.Store.DB, "revisions", v.RevisionID)
	if err != nil {
		fail(c, 404, "来源不存在")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	req, err := adapter.MediaRequest(ctx, v.RemoteURL, r.URL)
	if err != nil {
		fail(c, 400, "预览地址不可用，请重新采集")
		return
	}
	if requested := c.GetHeader("Range"); requested != "" {
		if len(requested) > 80 || !previewRange.MatchString(requested) {
			fail(c, 416, "无效的预览范围")
			return
		}
		req.Header.Set("Range", requested)
	}
	res, err := client.Do(req)
	if err != nil {
		fail(c, 502, "在线预览失败，可打开原笔记或重新采集")
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 206 {
		fail(c, 502, adapter.MediaStatusError(res.StatusCode).Error())
		return
	}
	mediaType, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	switch mediaType {
	case "image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime":
	default:
		fail(c, 502, "远程响应不是可预览的图片或视频")
		return
	}
	if res.ContentLength > maxMedia {
		fail(c, 413, "预览文件超过 512 MB")
		return
	}
	c.Header("Content-Type", mediaType)
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	if res.ContentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(res.ContentLength, 10))
	}
	for _, key := range []string{"Content-Range", "Accept-Ranges"} {
		if value := res.Header.Get(key); value != "" {
			c.Header(key, value)
		}
	}
	c.Status(res.StatusCode)
	_, _ = io.Copy(c.Writer, io.LimitReader(res.Body, maxMedia))
}
