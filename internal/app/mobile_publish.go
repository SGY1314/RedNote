package app

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Each user's own SQLite database holds only the remote ID and state. Scan and
// receiver credentials are returned once, never stored or restored by polling.
type mobileHandoffRecord struct {
	Session   miniappCloudSession `json:"session"`
	RequestID string              `json:"request_id"`
}

func (a *App) mobilePublishRoutes(api *gin.RouterGroup) {
	a.douyinMobileRoutes(api)
	api.GET("/miniapp/cloud", a.mobilePublishAvailability)
	api.POST("/publications/:id/mobile-handoff", a.createMobileHandoff)
	api.GET("/publications/:id/mobile-handoff", a.getMobileHandoff)
	api.POST("/publications/:id/mobile-handoff/cancel", a.cancelMobileHandoff)
}

func (a *App) mobilePublishAvailability(c *gin.Context) {
	client, err := readMiniappCloudConfig(a.mobileRoot())
	reason := ""
	if err != nil {
		reason = err.Error()
	} else if !a.mobileLaunchConfigured() {
		reason = "请先配置手机发布的小程序项目与体验环境"
	} else if !a.mobilePublicRouteReady(client.public) {
		reason = "手机发布需要可供手机访问的公网HTTPS交接地址"
	}
	c.JSON(200, gin.H{"available": reason == "", "reason": reason})
}

func activeMobileSession(s miniappCloudSession) bool {
	expires, err := time.Parse(time.RFC3339Nano, s.ExpiresAt)
	return err == nil && expires.After(time.Now()) && s.State != "cancelled" && s.State != "expired"
}

func (a *App) createMobileHandoff(c *gin.Context) {
	var input struct {
		RequestID string `json:"request_id"`
	}
	if !bind(c, &input) {
		return
	}
	if !miniappCloudTicketPattern.MatchString(input.RequestID) {
		fail(c, 400, "手机发布请求标识无效，请重新打开窗口")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if !mobilePublicationEligible(p) {
		fail(c, 409, "发布稿当前不可创建手机交接，请检查发布状态和内容")
		return
	}
	previous, err := store.Get[mobileHandoffRecord](a.Store.DB, "mobile_handoffs", p.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(c, 500, "读取手机交接失败")
		return
	}
	if err == nil && (previous.RequestID == input.RequestID || activeMobileSession(previous.Session)) {
		a.respondMobileHandoff(c, previous.Session, 200)
		return
	}
	client, err := readMiniappCloudConfig(a.mobileRoot())
	if err != nil {
		fail(c, 503, err.Error())
		return
	}
	if !a.mobileLaunchConfigured() {
		fail(c, 503, "手机发布尚未绑定有效小程序项目")
		return
	}
	if !a.mobilePublicRouteReady(client.public) {
		fail(c, 503, "手机发布需要可供手机访问的公网HTTPS交接地址")
		return
	}
	snapshot, files, err := a.mobilePublishSnapshot(p)
	if err != nil {
		fail(c, 409, err.Error())
		return
	}
	expires := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339Nano)
	record := mobileHandoffRecord{RequestID: input.RequestID, Session: miniappCloudSession{ID: ID(), State: "unknown", ExpiresAt: expires, CreatedAt: Now()}}
	// A lost HTTP reply must not silently upload the same private files again.
	if store.Put(a.Store.DB, "mobile_handoffs", p.ID, record) != nil {
		fail(c, 500, "保存交接记录失败")
		return
	}
	remote, err := client.upload(c.Request.Context(), snapshot, expires, files)
	if err != nil {
		fail(c, 502, "交接上传未能确认，请刷新状态；为避免重复上传，原票据有效期结束后可重新生成")
		return
	}
	if !activeMobileSession(remote) {
		fail(c, 502, "交接服务返回的票据已失效")
		return
	}
	record.Session = remote
	record.Session.Ticket, record.Session.LaunchPath, record.Session.BrowserURL = "", "", ""
	if store.Put(a.Store.DB, "mobile_handoffs", p.ID, record) != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		client.request(cleanup, "POST", "/control/sessions/"+url.PathEscape(remote.ID)+"/cancel", nil, "")
		fail(c, 500, "保存手机交接失败，请稍后重试")
		return
	}
	c.JSON(201, struct {
		miniappCloudSession
		MiniappSchemeURL string `json:"miniapp_scheme_url,omitempty"`
	}{remote, miniappSchemeURL(a.mobileRoot(), remote, client.public, time.Now())})
}

func (a *App) respondMobileHandoff(c *gin.Context, remote miniappCloudSession, status int) {
	remote.Ticket, remote.LaunchPath, remote.BrowserURL = "", "", ""
	if !activeMobileSession(remote) && remote.State != "cancelled" {
		remote.State = "expired"
	}
	c.JSON(status, remote)
}

func (a *App) readMobileHandoff(c *gin.Context, cancel bool) {
	// Authorize through this user's publication before consulting any remote ID.
	if _, ok := a.activePublication(c, c.Param("id")); !ok {
		return
	}
	record, err := store.Get[mobileHandoffRecord](a.Store.DB, "mobile_handoffs", c.Param("id"))
	if err != nil {
		fail(c, 404, "尚未创建手机交接")
		return
	}
	if !activeMobileSession(record.Session) {
		a.respondMobileHandoff(c, record.Session, 200)
		return
	}
	if record.Session.State == "unknown" {
		if cancel {
			fail(c, 409, "上传结果未能确认，无法确认撤销，请等待票据过期后重新生成")
			return
		}
		a.respondMobileHandoff(c, record.Session, 200)
		return
	}
	client, err := readMiniappCloudConfig(a.mobileRoot())
	if err != nil {
		fail(c, 503, err.Error())
		return
	}
	method, suffix := "GET", ""
	if cancel {
		method, suffix = "POST", "/cancel"
	}
	remote, err := client.request(c.Request.Context(), method, "/control/sessions/"+url.PathEscape(record.Session.ID)+suffix, nil, "")
	if err != nil {
		fail(c, 502, err.Error())
		return
	}
	if remote.ID != record.Session.ID {
		fail(c, 502, "交接会话不匹配")
		return
	}
	remote.Ticket, remote.LaunchPath, remote.BrowserURL = "", "", ""
	record.Session = remote
	if store.Put(a.Store.DB, "mobile_handoffs", c.Param("id"), record) != nil {
		fail(c, 500, "保存交接状态失败")
		return
	}
	a.respondMobileHandoff(c, remote, 200)
}

func (a *App) getMobileHandoff(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.readMobileHandoff(c, false)
}
func (a *App) cancelMobileHandoff(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.readMobileHandoff(c, true)
}

func mobilePublicationEligible(p domain.Publication) bool {
	return p.ManualStatus != "published" && p.DeletedAt == "" && (p.TargetPlatform == "" || p.TargetPlatform == "xhs") && (p.Kind == "image" || (p.Kind == "video" && len(p.AssetIDs) == 1)) && p.Ready && p.PublishedAt == "" && p.RemoteWorkID == "" && (p.OnlineState == "" || p.OnlineState == "failed") && strings.TrimSpace(p.Title) != "" && strings.TrimSpace(p.Body) != ""
}

// Caller holds a.mu so a new handoff cannot race the publication status change.
// Remote cancellation is confirmed first: a local flag alone cannot revoke an
// already claimed receiver on the independent handoff server.
func (a *App) finishPublicationHandoff(ctx context.Context, p domain.Publication) error {
	record, err := store.Get[mobileHandoffRecord](a.Store.DB, "mobile_handoffs", p.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return errors.New("读取手机交接失败，请稍后重试")
	}
	if !activeMobileSession(record.Session) {
		return nil
	}
	if record.Session.State == "unknown" {
		return errors.New("手机交接上传结果未确认，请等待票据过期后再标记已发布")
	}
	client, err := readMiniappCloudConfig(a.mobileRoot())
	if err != nil {
		return errors.New("无法连接交接服务撤销旧二维码，尚未更改发布状态")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	remote, err := client.request(ctx, "POST", "/control/sessions/"+url.PathEscape(record.Session.ID)+"/cancel", nil, "")
	if err != nil || remote.ID != record.Session.ID || remote.State != "cancelled" {
		return errors.New("旧二维码撤销未确认，尚未更改发布状态，请稍后重试")
	}
	remote.Ticket, remote.LaunchPath, remote.BrowserURL = "", "", ""
	record.Session = remote
	if err := store.Put(a.Store.DB, "mobile_handoffs", p.ID, record); err != nil {
		return errors.New("二维码已撤销，但交接状态保存失败，请重试")
	}
	return nil
}
