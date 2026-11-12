package app

import (
	"errors"
	"github.com/gin-gonic/gin"
	"net/url"
	"strings"
	"time"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Keep explicit tombstones for old clients; no archives are created or served.
func (a *App) exportPublication(c *gin.Context) { fail(c, 410, "发布包导出功能已移除") }
func (a *App) downloadPackage(c *gin.Context)   { fail(c, 410, "发布包导出功能已移除") }
func (a *App) runExport(j domain.Job) (string, error) {
	return "", errors.New("发布包导出功能已移除")
}
func (a *App) markPublished(c *gin.Context) {
	var req struct {
		PublishedAt  string `json:"published_at"`
		PublishedURL string `json:"published_url"`
	}
	if !bind(c, &req) {
		return
	}
	if _, e := time.Parse(time.RFC3339, req.PublishedAt); e != nil {
		fail(c, 400, "请填写有效发布时间")
		return
	}
	p0, e := store.Get[domain.Publication](a.Store.DB, "publications", c.Param("id"))
	if e != nil {
		fail(c, 404, "发布稿不存在")
		return
	}
	// A link is optional for manual records. Omission preserves any known link/ID.
	req.PublishedURL = strings.TrimSpace(req.PublishedURL)
	if req.PublishedURL != "" {
		u, err := url.Parse(req.PublishedURL)
		if err != nil || u.User != nil || u.Scheme != "https" || !publicationURLAllowed(p0.TargetPlatform, u) {
			fail(c, 400, "作品链接与目标平台不符")
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if !p.Ready {
		fail(c, 409, "请先准备素材")
		return
	}
	if p.OnlineState == "submitting" || p.OnlineState == "preparing" {
		fail(c, 409, "请等待当前任务结束")
		return
	}
	p.OnlineState = "published"
	p.ManualStatus = "published"
	if req.PublishedURL != "" {
		if p.TargetPlatform == "douyin" {
			_, p.RemoteWorkID = linkIdentity(req.PublishedURL)
		}
		p.PublishedURL = req.PublishedURL
	}
	p.PublishedAt = req.PublishedAt
	if e = store.Put(a.Store.DB, "publications", p.ID, p); e != nil {
		fail(c, 500, "保存发布结果失败")
		return
	}
	c.JSON(200, p)
}

// Manual display status is independent of remote receipts, which remain intact.
func (a *App) setPublicationStatus(c *gin.Context) {
	var req struct {
		Status   string `json:"status"`
		Revision int    `json:"revision"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Status != "ready" && req.Status != "published" {
		fail(c, 400, "请选择等待发布或已发布")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if !p.Ready {
		fail(c, 409, "请先在仿写项目准备完整发布稿")
		return
	}
	if p.Revision != req.Revision {
		fail(c, 409, "发布稿已更新，请刷新后重试")
		return
	}
	if req.Status == "published" {
		if err := a.finishPublicationHandoff(c.Request.Context(), p); err != nil {
			fail(c, 409, err.Error())
			return
		}
	}
	p.ManualStatus = req.Status
	p.Revision++
	p.UpdatedAt = Now()
	if err := store.Put(a.Store.DB, "publications", p.ID, p); err != nil {
		bad(c, err)
		return
	}
	c.JSON(200, p)
}
