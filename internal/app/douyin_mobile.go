package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type douyinHandoffRecord struct {
	RequestID   string              `json:"request_id"`
	Fingerprint string              `json:"fingerprint"`
	Session     douyinMobileSession `json:"session"`
	ClientEvent string              `json:"client_event,omitempty"`
}

func (a *App) douyinMobileRoutes(g *gin.RouterGroup) {
	g.GET("/miniapp/douyin/cloud", func(c *gin.Context) {
		client, err := readDouyinMobileConfig(a.mobileRoot())
		reason := ""
		if err != nil {
			reason = err.Error()
		}
		mode := "production"
		if client != nil {
			mode = client.config.LaunchEnvironment
		}
		c.JSON(200, gin.H{"available": err == nil, "reason": reason, "launch_environment": mode, "note": "开发调试任务请在开发者工具填写启动参数并生成预览码；正式二维码用于小程序线上版本。"})
	})
	g.POST("/publications/:id/douyin-handoff", a.createDouyinHandoff)
	g.GET("/publications/:id/douyin-handoff", func(c *gin.Context) { a.readDouyinHandoff(c, false) })
	g.POST("/publications/:id/douyin-handoff/cancel", func(c *gin.Context) { a.readDouyinHandoff(c, true) })
}
func douyinPhoneEligible(p domain.Publication) bool {
	return p.ManualStatus != "published" && p.DeletedAt == "" && p.TargetPlatform == "douyin" && p.Kind == "video" && p.Ready && len(p.AssetIDs) == 1 && p.PublishedAt == "" && p.RemoteWorkID == "" && (p.OnlineState == "" || p.OnlineState == "failed") && strings.TrimSpace(p.Title) != "" && strings.TrimSpace(p.Body) != ""
}
func (a *App) douyinSnapshot(p domain.Publication) (map[string]any, string, int64, string, error) {
	bad := func(msg string) (map[string]any, string, int64, string, error) {
		return nil, "", 0, "", errors.New(msg)
	}
	if !douyinPhoneEligible(p) {
		return bad("抖音扫码发布仅支持已就绪、尚未发布的单视频稿件")
	}
	v, err := store.Get[domain.Version](a.Store.DB, "versions", p.VersionID)
	if err != nil || v.Status != "confirmed" || v.ProjectID != p.ProjectID || v.Media == nil || v.Media.Kind != p.Kind || v.Media.CoverID != p.CoverID || !slices.Equal(v.Media.AssetIDs, p.AssetIDs) || v.Title != p.Title || v.Body != p.Body || !slices.Equal(v.Topics, p.Topics) {
		return bad("发布稿与已确认版本不一致，请重新确认版本并建立发布稿")
	}
	if len([]rune(p.Title)) > 60 || len(p.Body) > 20000 || len(p.Topics) > 30 {
		return bad("抖音视频标题须不超过60字，正文和标签须符合交接限制")
	}
	for _, t := range p.Topics {
		if len([]rune(t)) > 100 {
			return bad("标签长度超出限制")
		}
	}
	asset, err := store.Get[domain.Asset](a.Store.DB, "assets", p.AssetIDs[0])
	if err != nil || asset.Kind != "video" || asset.Status != "ready" {
		return bad("发布视频未就绪或不属于当前账号")
	}
	f, err := a.openMedia(asset.Path)
	if err != nil {
		return bad("发布视频文件缺失或路径无效")
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 12 || info.Size() > 200<<20 {
		return bad("抖音扫码视频须为有效MP4且不超过200MiB")
	}
	header := make([]byte, 12)
	if _, err = io.ReadFull(f, header); err != nil || string(header[4:8]) != "ftyp" {
		return bad("当前扫码发布支持MP4，请先转换视频格式")
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return bad("无法读取发布视频")
	}
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return bad("读取发布视频失败")
	}
	digest := hex.EncodeToString(h.Sum(nil))
	if asset.SHA256 != "" && !strings.EqualFold(asset.SHA256, digest) {
		return bad("视频文件已变化，请重新上传并确认")
	}
	path, err := a.mediaPath(asset.Path)
	if err != nil {
		return bad("发布视频路径无效")
	}
	snapshot := map[string]any{"platform": "douyin", "title": p.Title, "body": p.Body, "topics": append([]string{}, p.Topics...), "version": p.VersionID, "assets": []map[string]any{{"id": asset.ID, "kind": "video", "bytes": info.Size()}}}
	raw, _ := json.Marshal([]any{snapshot, digest, p.CoverID})
	fingerprint := sha256.Sum256(raw)
	return snapshot, path, info.Size(), hex.EncodeToString(fingerprint[:]), nil
}
func dyActive(s douyinMobileSession) bool {
	expiry, e := time.Parse(time.RFC3339Nano, s.ExpiresAt)
	return e == nil && expiry.After(time.Now()) && s.State != "cancelled"
}
func dySessionResponse(s douyinMobileSession, event string) gin.H {
	state := s.State
	if !dyActive(s) && state != "cancelled" {
		state = "expired"
	}
	if state == "ready" {
		state = "created"
	}
	if state == "uploading" {
		state = "unknown"
	}
	return gin.H{"id": s.ID, "state": state, "expires_at": s.ExpiresAt, "client_event": event, "confirmation": "unverified"}
}
func (a *App) createDouyinHandoff(c *gin.Context) {
	var input struct {
		RequestID string `json:"request_id"`
	}
	if !bind(c, &input) {
		return
	}
	if !miniappCloudTicketPattern.MatchString(input.RequestID) {
		fail(c, 400, "手机发布请求标识无效")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.TargetPlatform != "douyin" {
		fail(c, 409, "此接口仅用于抖音发布稿")
		return
	}
	key := "douyin:" + p.ID
	previous, err := store.Get[douyinHandoffRecord](a.Store.DB, "mobile_handoffs", key)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(c, 500, "读取抖音交接记录失败")
		return
	}
	if err == nil && (previous.RequestID == input.RequestID || dyActive(previous.Session)) {
		c.JSON(200, dySessionResponse(previous.Session, previous.ClientEvent))
		return
	}
	client, err := readDouyinMobileConfig(a.mobileRoot())
	if err != nil {
		fail(c, 503, err.Error())
		return
	}
	snapshot, path, size, fingerprint, err := a.douyinSnapshot(p)
	if err != nil {
		fail(c, 409, err.Error())
		return
	}
	expires := time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339Nano)
	snapshot["expiresAt"] = expires
	record := douyinHandoffRecord{RequestID: input.RequestID, Fingerprint: fingerprint, Session: douyinMobileSession{ID: "pending_" + ID(), State: "uploading", ExpiresAt: expires}}
	if store.Put(a.Store.DB, "mobile_handoffs", key, record) != nil {
		fail(c, 500, "保存抖音交接记录失败")
		return
	}
	created, err := client.control(c.Request.Context(), "create", snapshot)
	if err != nil {
		fail(c, 502, "创建结果未能确认，请等待本次任务过期后重试，避免重复上传")
		return
	}
	if !validDouyinSession(created.Session) || created.Session.State != "uploading" || !dyCredential.MatchString(created.Ticket) {
		fail(c, 502, "抖音云返回无效任务，请等待过期后重试")
		return
	}
	record.Session = created.Session
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		r, e := client.control(ctx, "cancel", map[string]string{"sessionId": record.Session.ID})
		if e == nil && r.Cancelled {
			record.Session.State = "cancelled"
			_ = store.Put(a.Store.DB, "mobile_handoffs", key, record)
		}
	}
	if store.Put(a.Store.DB, "mobile_handoffs", key, record) != nil {
		cleanup()
		fail(c, 500, "保存抖音任务失败")
		return
	}
	if len(created.Uploads) != 1 || created.Uploads[0].AssetID != p.AssetIDs[0] {
		cleanup()
		fail(c, 502, "抖音云上传清单无效")
		return
	}
	if err = client.upload(c.Request.Context(), created.Uploads[0], path, size); err != nil {
		cleanup()
		fail(c, 502, err.Error())
		return
	}
	_, _, _, currentFingerprint, checkErr := a.douyinSnapshot(p)
	if checkErr != nil || currentFingerprint != fingerprint {
		cleanup()
		fail(c, 409, "视频或版本在上传时发生变化，请重新生成")
		return
	}
	committed, err := client.control(c.Request.Context(), "commit", map[string]string{"sessionId": record.Session.ID})
	if err != nil || committed.Session.ID != record.Session.ID || committed.Session.State != "ready" || !validDouyinSession(committed.Session) {
		cleanup()
		fail(c, 502, "视频上传确认失败，请刷新任务状态")
		return
	}
	record.Session = committed.Session
	if store.Put(a.Store.DB, "mobile_handoffs", key, record) != nil {
		cleanup()
		fail(c, 500, "保存抖音任务状态失败")
		return
	}
	result := dySessionResponse(record.Session, "")
	if client.config.LaunchEnvironment == "development" {
		result["launch_path"] = "pages/publish/index?ticket=" + created.Ticket
		c.Header("Cache-Control", "no-store")
		c.JSON(201, result)
		return
	}
	qr, err := client.qrcode(c.Request.Context(), created.Ticket)
	if err != nil {
		result["qr_error"] = err.Error()
	} else {
		result["qr_image"] = qr
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(201, result)
}
func (a *App) readDouyinHandoff(c *gin.Context, cancelTask bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.TargetPlatform != "douyin" {
		fail(c, 404, "此稿件没有抖音扫码任务")
		return
	}
	key := "douyin:" + p.ID
	record, err := store.Get[douyinHandoffRecord](a.Store.DB, "mobile_handoffs", key)
	if err != nil {
		fail(c, 404, "尚未创建抖音扫码任务")
		return
	}
	if !dyActive(record.Session) {
		c.JSON(200, dySessionResponse(record.Session, record.ClientEvent))
		return
	}
	if strings.HasPrefix(record.Session.ID, "pending_") {
		if cancelTask {
			fail(c, 409, "任务创建结果未确认，请等待过期")
			return
		}
		c.JSON(200, dySessionResponse(record.Session, ""))
		return
	}
	client, err := readDouyinMobileConfig(a.mobileRoot())
	if err != nil {
		fail(c, 503, err.Error())
		return
	}
	action := "status"
	if cancelTask {
		action = "cancel"
	}
	reply, err := client.control(c.Request.Context(), action, map[string]string{"sessionId": record.Session.ID})
	if err != nil {
		fail(c, 502, err.Error())
		return
	}
	if cancelTask {
		if !reply.Cancelled {
			fail(c, 502, "抖音任务撤销未确认")
			return
		}
		record.Session.State = "cancelled"
	} else {
		if !validDouyinSession(reply.Session) || reply.Session.ID != record.Session.ID {
			fail(c, 502, "抖音云任务状态不匹配")
			return
		}
		record.Session = reply.Session
		if reply.ClientResult != nil {
			switch reply.ClientResult.Event {
			case "editor_open_requested", "client_publish_success", "client_publish_incomplete":
				record.ClientEvent = reply.ClientResult.Event
			}
		}
	}
	if store.Put(a.Store.DB, "mobile_handoffs", key, record) != nil {
		fail(c, 500, "保存抖音交接状态失败")
		return
	}
	// Client callbacks are evidence to review, never a verified Publication mutation.
	c.Header("Cache-Control", "no-store")
	c.JSON(200, dySessionResponse(record.Session, record.ClientEvent))
}
