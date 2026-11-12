package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

var errPublishReview = errors.New("请到小红书官方窗口检查；工作台不会点击发布。若已手动发布请记录结果，否则可核实后重新准备")

type publisherAccount struct {
	State     string `json:"state,omitempty"`
	Message   string `json:"message,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
	LoggedIn  bool   `json:"is_logged_in"`
	Username  string `json:"username"`
	UserID    string `json:"user_id"`
}

func (a *App) publisherCall(ctx context.Context, method, path string, body any, result any) error {
	u, err := url.Parse(a.Config.PublisherURL)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || !net.ParseIP(u.Hostname()).IsLoopback() {
		return errors.New("发布服务地址必须是本机 HTTP 地址")
	}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, a.Config.PublisherURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.PublisherToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("扫码发布服务无法连接或响应超时，请重启工作台并检查网络")
	}
	defer res.Body.Close()
	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Code    string          `json:"code"`
	}
	decodeErr := json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&envelope)
	if res.StatusCode != 200 || decodeErr != nil || !envelope.Success {
		if path == "/api/v1/prepare/editor" {
			return errors.New("预发布窗口不可用，请核实是否已手动发布；未发布可重新准备")
		}
		if decodeErr == nil && (path == "/api/v1/publish" || path == "/api/v1/publish_video" || path == "/api/v1/prepare" || path == "/api/v1/prepare_video") {
			if message, ok := publisherDiagnosticMessages[envelope.Code]; ok {
				return &publisherDiagnosticError{message: message}
			}
		}
		return errors.New("小红书准备未完成，请检查专用官方窗口，可在页面补填并手动发布；若没有窗口，请重启工作台。详情见 logs/publisher.err.log")
	}
	if result != nil && json.Unmarshal(envelope.Data, result) != nil {
		return errors.New("发布服务返回格式异常")
	}
	return nil
}

func (a *App) publisherStatus(c *gin.Context) {
	if !a.publisherMu.TryLock() {
		fail(c, 409, "发布服务正在操作，请稍后查看登录状态")
		return
	}
	defer a.publisherMu.Unlock()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 50*time.Second)
	defer cancel()
	var account publisherAccount
	if err := a.publisherCall(ctx, "GET", "/api/v1/login/status", nil, &account); err != nil {
		fail(c, 503, err.Error())
		return
	}
	c.JSON(200, account)
}

func (a *App) publisherQR(c *gin.Context) {
	if !a.publisherMu.TryLock() {
		fail(c, 409, "正在发布，请完成后再连接账号")
		return
	}
	defer a.publisherMu.Unlock()
	if a.hasPendingPublish() {
		fail(c, 409, "尚有发布任务，请完成后再连接账号")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	var qr struct {
		Img      string `json:"img"`
		Timeout  string `json:"timeout"`
		LoggedIn bool   `json:"is_logged_in"`
	}
	if err := a.publisherCall(ctx, "GET", "/api/v1/login/qrcode", nil, &qr); err != nil {
		fail(c, 503, err.Error())
		return
	}
	if qr.Img != "" && !strings.HasPrefix(qr.Img, "data:image/png;base64,") && !strings.HasPrefix(qr.Img, "data:image/jpeg;base64,") {
		fail(c, 502, "登录二维码格式异常")
		return
	}
	c.JSON(200, qr)
}

func (a *App) hasPendingPublish() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		return true
	}
	for _, j := range jobs {
		if (j.Kind == "publish" || j.Kind == "post_sync") && (j.State == "queued" || j.State == "running") {
			return true
		}
	}
	return false
}

func (a *App) publisherDisconnect(c *gin.Context) {
	if !a.publisherMu.TryLock() {
		fail(c, 409, "正在发布，请完成后再断开账号")
		return
	}
	defer a.publisherMu.Unlock()
	if a.hasPendingPublish() {
		fail(c, 409, "尚有发布任务，请完成后再断开账号")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	if err := a.publisherCall(ctx, "DELETE", "/api/v1/login/cookies", nil, nil); err != nil {
		fail(c, 503, err.Error())
		return
	}
	c.JSON(200, gin.H{"disconnected": true})
}

func (a *App) validateOnlinePublication(p domain.Publication) error {
	if p.DeletedAt != "" {
		return errors.New("发布稿已在回收站，请先恢复")
	}
	if !p.Ready || len(p.AssetIDs) == 0 {
		return errors.New("请先准备文案和发布素材")
	}
	if p.ManualStatus == "published" || p.PublishedAt != "" || p.RemoteWorkID != "" {
		return errors.New("该发布稿已标记发布，不能重复提交")
	}
	if p.OnlineState != "" && p.OnlineState != "failed" {
		return errors.New("该发布稿已有提交记录，请先核实结果，不能重复发布")
	}
	if strings.TrimSpace(p.Title) == "" || utf8.RuneCountInString(p.Title) > 20 {
		return errors.New("网页发布标题须为 1 至 20 个字，请修改文案后重新准备发布稿")
	}
	if strings.TrimSpace(p.Body) == "" || utf8.RuneCountInString(p.Body+strings.Join(p.Topics, " ")) > 1000 {
		return errors.New("网页发布正文及话题须在 1000 字以内，请修改后重新准备")
	}
	if len(p.Topics) > 10 {
		return errors.New("网页发布最多支持 10 个话题")
	}
	if p.Kind != "image" && p.Kind != "video" {
		return errors.New("不支持的发布类型")
	}
	if p.Kind == "video" && (len(p.AssetIDs) != 1 || p.CoverID != "") {
		return errors.New("扫码发布暂支持单视频及平台默认封面，请移除自选封面后重新准备发布稿")
	}
	return nil
}

func (a *App) submitPublication(c *gin.Context) {
	if p, err := store.Get[domain.Publication](a.Store.DB, "publications", c.Param("id")); err == nil && p.TargetPlatform == "douyin" {
		a.submitDouyin(c)
		return
	}
	var req struct {
		AccountID string `json:"account_id"`
		Confirm   bool   `json:"confirm"`
	}
	if !bind(c, &req) {
		return
	}
	if !req.Confirm || req.AccountID == "" {
		fail(c, 400, "请确认发布账号和发布内容")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if err := a.validateOnlinePublication(p); err != nil {
		fail(c, 409, err.Error())
		return
	}
	j := newJob("publish", p.ID, map[string]any{"account_id": req.AccountID})
	p.OnlineState = "queued"
	p.OnlineAccount = req.AccountID
	p.OnlineJobID = j.ID
	if err := a.Store.Transaction(func(tx *sql.Tx) error {
		if err := store.Put(tx, "jobs", j.ID, j); err != nil {
			return err
		}
		return store.Put(tx, "publications", p.ID, p)
	}); err != nil {
		fail(c, 500, "保存发布任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}

func (a *App) runPublish(j domain.Job) (string, error) {
	a.publisherMu.Lock()
	defer a.publisherMu.Unlock()
	p, err := store.Get[domain.Publication](a.Store.DB, "publications", j.Target)
	if err != nil {
		return "", err
	}
	if p.OnlineState != "queued" || p.OnlineJobID != j.ID || p.ManualStatus == "published" || p.PublishedAt != "" {
		return "", errPublishReview
	}
	preflightFail := func(e error) (string, error) {
		a.mu.Lock()
		defer a.mu.Unlock()
		latest, readErr := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
		if readErr == nil && latest.PublishedAt == "" && latest.OnlineJobID == j.ID {
			latest.OnlineState = "failed"
			store.Put(a.Store.DB, "publications", p.ID, latest)
		}
		return "", e
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Minute)
	defer cancel()
	var account publisherAccount
	checkCtx, checkCancel := context.WithTimeout(ctx, 50*time.Second)
	err = a.publisherCall(checkCtx, "GET", "/api/v1/login/status", nil, &account)
	checkCancel()
	if err != nil {
		return preflightFail(err)
	}
	if !account.LoggedIn || account.UserID == "" {
		return preflightFail(errors.New("登录已失效或无法识别账号，请重新扫码"))
	}
	if account.UserID != asString(j.Payload["account_id"]) {
		return preflightFail(errors.New("当前账号与确认的发布账号不一致，请重新核对"))
	}
	ids := append([]string{}, p.AssetIDs...)
	if p.Kind == "image" && p.CoverID != "" {
		ids = []string{p.CoverID}
		for _, id := range p.AssetIDs {
			if id != p.CoverID {
				ids = append(ids, id)
			}
		}
	}
	paths := []string{}
	for _, id := range ids {
		asset, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if e != nil || asset.Status != "ready" || asset.Kind != p.Kind {
			return preflightFail(errors.New("发布素材缺失或类型错误"))
		}
		path, e := a.mediaPath(asset.Path)
		if e != nil {
			return preflightFail(errors.New("本地素材文件无法读取"))
		}
		paths = append(paths, path)
	}
	body := map[string]any{"editor_id": p.ID, "title": p.Title, "content": p.Body, "tags": p.Topics, "visibility": "公开可见", "expected_user_id": account.UserID}
	endpoint := "/api/v1/prepare"
	if p.Kind == "video" {
		endpoint = "/api/v1/prepare_video"
		body["video"] = paths[0]
	} else {
		body["images"] = paths
	}
	// Persist before opening the editor: the user may manually publish even if the response is lost.
	a.mu.Lock()
	latest, e := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if e == nil && (latest.ManualStatus == "published" || latest.PublishedAt != "" || latest.OnlineState != "queued" || latest.OnlineJobID != j.ID) {
		a.mu.Unlock()
		return "", errPublishReview
	}
	if e == nil {
		latest.OnlineState = "needs_review"
		e = store.Put(a.Store.DB, "publications", p.ID, latest)
	}
	a.mu.Unlock()
	if e != nil {
		return "", e
	}
	var receipt struct {
		Prepared bool `json:"prepared"`
	}
	if err = a.publisherCall(ctx, "POST", endpoint, body, &receipt); err != nil {
		var diagnostic *publisherDiagnosticError
		if errors.As(err, &diagnostic) {
			return "", errors.Join(errPublishReview, diagnostic)
		}
		return "", errPublishReview
	}
	if !receipt.Prepared {
		return "", errPublishReview
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	latest, e = store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if e != nil {
		return "", errPublishReview
	}
	if latest.PublishedAt != "" {
		return "已由用户记录发布结果", nil
	}
	latest.OnlineState = "manual_ready"
	if e = store.Put(a.Store.DB, "publications", p.ID, latest); e != nil {
		return "", errPublishReview
	}
	return "上传准备完成，请在专用官方窗口预览并手动点击发布，完成后记录发布结果", nil
}

func (a *App) resolvePublication(c *gin.Context) {
	if !a.publisherMu.TryLock() {
		fail(c, 409, "正在操作官方浏览器，请稍后重新准备")
		return
	}
	defer a.publisherMu.Unlock()
	var req struct {
		NotPublished bool `json:"not_published"`
	}
	if !bind(c, &req) {
		return
	}
	if !req.NotPublished {
		fail(c, 400, "请先到创作平台确认未发布")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.OnlineState != "unknown" && p.OnlineState != "needs_review" && p.OnlineState != "queued" && p.OnlineState != "manual_ready" && p.OnlineState != "prepared" && p.OnlineState != "manual_review" {
		fail(c, 409, "该发布稿不需要核实")
		return
	}
	// Legacy prepared records may have no job. Reject every active preparation,
	// including an orphaned job, instead of permanently blocking old drafts.
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "读取发布任务失败")
		return
	}
	for _, job := range jobs {
		if (job.ID == p.OnlineJobID || (job.Kind == "publish" && job.Target == p.ID)) && (job.State == "running" || job.State == "queued") {
			fail(c, 409, "任务尚未结束，请稍后核实")
			return
		}
	}
	if p.PublishedAt != "" || p.ManualStatus == "published" || p.RemoteWorkID != "" {
		fail(c, 409, "已发布内容不能重置")
		return
	}
	// Closing the old editor prevents two active windows for the same draft.
	if p.TargetPlatform != "douyin" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		if err := a.publisherCall(ctx, "DELETE", "/api/v1/prepare/editor", map[string]any{"editor_id": p.ID}, nil); err != nil {
			fail(c, 503, "无法关闭旧预发布窗口，请重启工作台后再重新准备")
			return
		}
	}
	p.OnlineState = "failed"
	if err = store.Put(a.Store.DB, "publications", p.ID, p); err != nil {
		fail(c, 500, "保存核实结果失败")
		return
	}
	c.JSON(200, p)
}

// Shared preparation endpoint; legacy /publish is also preparation-only for XHS.
func (a *App) preparePublication(c *gin.Context) {
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.TargetPlatform == "douyin" {
		a.prepareDouyin(c)
		return
	}
	a.submitPublication(c)
}

func (a *App) openXHSEditor(c *gin.Context) {
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.TargetPlatform == "douyin" {
		fail(c, 400, "请选择小红书发布稿")
		return
	}
	if !a.publisherMu.TryLock() {
		fail(c, 409, "正在准备，请稍后再预览")
		return
	}
	defer a.publisherMu.Unlock()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	if err := a.publisherCall(ctx, "POST", "/api/v1/prepare/editor", map[string]any{"editor_id": p.ID}, nil); err != nil {
		fail(c, 409, err.Error())
		return
	}
	c.JSON(200, gin.H{"opened": true})
}
