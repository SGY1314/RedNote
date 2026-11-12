package app

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

var douyinID = regexp.MustCompile(`^\d{10,25}$`)
var douyinSearchPath = regexp.MustCompile(`^/(jingxuan/)?search/[^/]+/?$`)

func douyinModalID(u *url.URL) string {
	if u.Hostname() != "www.douyin.com" && u.Hostname() != "douyin.com" {
		return ""
	}
	if u.Path != "/" && u.Path != "" && strings.TrimSuffix(u.Path, "/") != "/jingxuan" && !douyinSearchPath.MatchString(u.Path) {
		return ""
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(q["modal_id"]) != 1 || !douyinID.MatchString(q.Get("modal_id")) {
		return ""
	}
	return q.Get("modal_id")
}

func canonicalDouyinLink(raw string) string {
	if !validDouyinLink(raw) {
		return raw
	}
	_, id := linkIdentity(raw)
	if id != "" {
		return "https://www.douyin.com/video/" + id
	}
	return raw
}

func linkIdentity(raw string) (string, string) {
	u, e := url.Parse(raw)
	if e != nil {
		return "", ""
	}
	h := strings.ToLower(u.Hostname())
	if h == "douyin.com" || h == "www.douyin.com" || h == "v.douyin.com" {
		if h == "v.douyin.com" {
			return "douyin", ""
		}
		if id := douyinModalID(u); id != "" {
			return "douyin", id
		}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) == 2 && (parts[0] == "video" || parts[0] == "note") && douyinID.MatchString(parts[1]) {
			return "douyin", parts[1]
		}
		return "douyin", ""
	}
	m := notePattern.FindStringSubmatch(u.Path)
	if len(m) > 1 {
		return "xhs", m[1]
	}
	return "xhs", ""
}
func validDouyinLink(raw string) bool {
	u, e := url.Parse(raw)
	if e != nil || u.User != nil || u.Port() != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return false
	}
	p, id := linkIdentity(raw)
	return p == "douyin" && (id != "" && (strings.HasPrefix(u.Path, "/video/") || douyinModalID(u) != "") || u.Hostname() == "v.douyin.com" && regexp.MustCompile(`^/[A-Za-z0-9_-]+/?$`).MatchString(u.Path))
}
func publicationURLAllowed(platform string, u *url.URL) bool {
	if u.Port() != "" {
		return false
	}
	if platform == "douyin" {
		p, id := linkIdentity(u.String())
		return p == "douyin" && (id != "" || validDouyinLink(u.String()))
	}
	return u.Hostname() == "www.xiaohongshu.com" || u.Hostname() == "xiaohongshu.com" || u.Hostname() == "xhslink.com" || u.Hostname() == "xhslink.cn"
}

type douyinAccount struct {
	UserID          string `json:"user_id"`
	Username        string `json:"username"`
	LoggedIn        bool   `json:"is_logged_in"`
	MainVerified    bool   `json:"main_verified"`
	CreatorVerified bool   `json:"creator_verified"`
	State           string `json:"state"`
	Image           string `json:"img,omitempty"`
}
type douyinFile struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type douyinDraft struct {
	PublicationID string       `json:"publication_id"`
	AccountID     string       `json:"account_id"`
	Title         string       `json:"title"`
	Caption       string       `json:"caption"`
	Kind          string       `json:"kind"`
	Visibility    string       `json:"visibility"`
	Files         []douyinFile `json:"files"`
	Cover         *douyinFile  `json:"cover,omitempty"`
}
type douyinPreview struct {
	Token       string        `json:"token"`
	ExpiresAt   string        `json:"expires_at"`
	Account     douyinAccount `json:"account"`
	Caption     string        `json:"caption"`
	Title       string        `json:"title"`
	Visibility  string        `json:"visibility"`
	Image       string        `json:"image"`
	AssetIDs    []string      `json:"asset_ids"`
	CoverID     string        `json:"cover_id"`
	PreparedID  string        `json:"-"`
	Fingerprint string        `json:"-"`
	Draft       douyinDraft   `json:"-"`
}

func (a *App) douyinRoutes(g *gin.RouterGroup) {
	g.POST("/platforms/douyin/account", a.douyinAccountHandler("account"))
	g.GET("/platforms/douyin/account", a.douyinAccountHandler("account"))
	g.POST("/platforms/douyin/login", a.douyinAccountHandler("login"))
	g.GET("/platforms/douyin/login", a.douyinAccountHandler("login_status"))
	g.POST("/platforms/douyin/logout", a.douyinAccountHandler("logout"))
	g.POST("/platforms/douyin/browser", a.douyinAccountHandler("open_browser"))
	g.POST("/publications/:id/publish-prepare", a.preparePublication)
	g.GET("/publications/:id/publish-preview", a.previewDouyin)
	g.POST("/publications/:id/publish-status", a.douyinResult)
}
func (a *App) douyinAccountHandler(op string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.douyinMu.TryLock() {
			fail(c, 409, "抖音操作正在执行，请稍后再试")
			return
		}
		defer a.douyinMu.Unlock()
		if op == "login" || op == "logout" || op == "open_browser" {
			if a.douyinBusy() {
				fail(c, 409, "请等待抖音发布任务结束再切换账号")
				return
			}
			a.douyinPreviews = nil
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 75*time.Second)
		defer cancel()
		var result douyinAccount
		var args any
		if op == "open_browser" {
			var req struct {
				Target        string `json:"target"`
				PublicationID string `json:"publication_id"`
			}
			_ = c.ShouldBindJSON(&req)
			if req.Target != "" && req.Target != "main" && req.Target != "creator" && req.Target != "editor" {
				fail(c, 400, "浏览器目标无效")
				return
			}
			if req.Target == "editor" {
				p, err := store.Get[domain.Publication](a.Store.DB, "publications", req.PublicationID)
				if err != nil || p.TargetPlatform != "douyin" || p.OnlineState != "manual_review" {
					fail(c, 409, "该稿件没有等待核对的抖音编辑页")
					return
				}
			}
			args = req
		}
		if e := a.douyinCall(ctx, op, args, &result); e != nil {
			fail(c, 503, e.Error())
			return
		}
		if result.Image != "" && !strings.HasPrefix(result.Image, "data:image/png;base64,") {
			fail(c, 502, "二维码格式错误")
			return
		}
		c.JSON(200, result)
	}
}
func (a *App) douyinBusy() bool {
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		return true
	}
	for _, j := range jobs {
		if strings.HasPrefix(j.Kind, "douyin_") && (j.State == "queued" || j.State == "running") {
			return true
		}
	}
	return false
}
func (a *App) runDouyinCollect(j domain.Job) (string, error) {
	raw := asString(j.Payload["url"])
	if !validDouyinLink(raw) {
		return "", errors.New("抖音链接无效")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 100*time.Second)
	defer cancel()
	var d map[string]any
	if e := a.douyinCall(ctx, "collect", map[string]any{"url": raw}, &d); e != nil {
		return "", e
	}
	id := asString(d["作品ID"])
	if !douyinID.MatchString(id) || asString(d["作品类型"]) != "视频" || len(texts(d["下载地址"])) == 0 {
		return "", errors.New("未读取到有效公开视频")
	}
	_, expected := linkIdentity(raw)
	if expected != "" && id != expected {
		return "", errors.New("返回作品与请求链接不一致")
	}
	return a.saveCollected(j, "https://www.douyin.com/video/"+id, "douyin", d)
}
func (a *App) douyinDraft(p domain.Publication, account, visibility string) (douyinDraft, error) {
	d := douyinDraft{PublicationID: p.ID, AccountID: account, Title: p.Title, Caption: strings.TrimSpace(p.Body), Kind: p.Kind, Visibility: visibility}
	for _, t := range p.Topics {
		d.Caption += "\n#" + strings.TrimLeft(t, "#")
	}
	if p.TargetPlatform != "douyin" || !p.Ready || p.PublishedAt != "" || p.ManualStatus == "published" || p.RemoteWorkID != "" || account == "" || (visibility != "public" && visibility != "self") {
		return d, errors.New("请检查目标平台、登录账号、素材和可见性")
	}
	if utf8.RuneCountInString(p.Title) > 30 || strings.TrimSpace(p.Title) == "" || utf8.RuneCountInString(d.Caption) > 1000 {
		return d, errors.New("首版网页适配支持 1–30 字标题及最多 1000 字正文和话题，请编辑后重新建立发布稿")
	}
	if p.Kind != "video" && p.Kind != "image" || len(p.AssetIDs) == 0 || len(p.AssetIDs) > 35 || p.Kind == "video" && len(p.AssetIDs) != 1 {
		return d, errors.New("请选择有序图片或单个 MP4 视频")
	}
	read := func(id, kind string) (douyinFile, error) {
		out := douyinFile{ID: id}
		asset, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if e != nil || asset.Status != "ready" || asset.Kind != kind || asset.DeletedAt != "" {
			return out, errors.New("素材不可用")
		}
		if kind == "video" && strings.ToLower(filepath.Ext(asset.Path)) != ".mp4" {
			return out, errors.New("抖音视频请选择 MP4 格式")
		}
		f, e := a.openMedia(asset.Path)
		if e != nil {
			return out, e
		}
		defer f.Close()
		h := sha256.New()
		if _, e = io.Copy(h, f); e != nil {
			return out, e
		}
		out.SHA256 = hex.EncodeToString(h.Sum(nil))
		if asset.SHA256 != "" && out.SHA256 != asset.SHA256 {
			return out, errors.New("素材内容发生变化，请重新上传")
		}
		out.Path, e = a.mediaPath(asset.Path)
		return out, e
	}
	for _, id := range p.AssetIDs {
		f, e := read(id, p.Kind)
		if e != nil {
			return d, e
		}
		d.Files = append(d.Files, f)
	}
	if p.CoverID != "" {
		f, e := read(p.CoverID, "image")
		if e != nil {
			return d, e
		}
		d.Cover = &f
	}
	return d, nil
}
func fingerprint(d douyinDraft) string {
	b := sha256.Sum256([]byte(jsonString(d)))
	return hex.EncodeToString(b[:])
}
func (a *App) prepareDouyin(c *gin.Context) {
	var req struct {
		AccountID  string `json:"account_id"`
		Visibility string `json:"visibility"`
	}
	if !bind(c, &req) {
		return
	}
	if !a.douyinMu.TryLock() {
		fail(c, 409, "抖音正在操作，请稍后再试")
		return
	}
	defer a.douyinMu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.OnlineState != "" && p.OnlineState != "failed" && p.OnlineState != "prepared" && p.OnlineState != "manual_review" {
		fail(c, 409, "该稿件已有任务或提交记录，请先核实结果")
		return
	}
	if a.douyinBusy() {
		fail(c, 409, "已有抖音发布任务，请稍后准备")
		return
	}
	if _, e := a.douyinDraft(p, req.AccountID, req.Visibility); e != nil {
		bad(c, e)
		return
	}
	delete(a.douyinPreviews, p.ID)
	j := newJob("douyin_prepare", p.ID, map[string]any{"account_id": req.AccountID, "visibility": req.Visibility})
	p.OnlineState = "preparing"
	p.OnlineJobID = j.ID
	p.OnlineAccount = req.AccountID
	p.Visibility = req.Visibility
	if e := a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "jobs", j.ID, j); e != nil {
			return e
		}
		return store.Put(tx, "publications", p.ID, p)
	}); e != nil {
		fail(c, 500, "保存准备任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}
func (a *App) runDouyinPrepare(j domain.Job) (result string, err error) {
	a.douyinMu.Lock()
	defer a.douyinMu.Unlock()
	defer func() {
		if err != nil {
			a.setDouyinState(j, "failed", "")
		}
	}()
	p, err := store.Get[domain.Publication](a.Store.DB, "publications", j.Target)
	if err != nil {
		return "", err
	}
	d, err := a.douyinDraft(p, asString(j.Payload["account_id"]), asString(j.Payload["visibility"]))
	if err != nil {
		return "", err
	}
	var prepared struct {
		PreparedID    string        `json:"prepared_id"`
		Account       douyinAccount `json:"account"`
		Image         string        `json:"image"`
		Verified      bool          `json:"verified"`
		ManualReview  bool          `json:"manual_review"`
		ReviewReason  string        `json:"review_reason"`
		PublicationID string        `json:"publication_id"`
	}
	ctx, cancel := context.WithTimeout(a.ctx, 12*time.Minute)
	defer cancel()
	if err = a.douyinCall(ctx, "prepare", d, &prepared); err != nil {
		return "", err
	}
	if prepared.ManualReview {
		validReason := prepared.ReviewReason == "editor_title_mismatch" || prepared.ReviewReason == "editor_caption_mismatch" || prepared.ReviewReason == "editor_visibility_mismatch" || prepared.ReviewReason == "editor_media_unverified"
		if !validReason || prepared.Verified || prepared.PreparedID != "" || prepared.PublicationID != p.ID || prepared.Account.UserID != d.AccountID || !prepared.Account.LoggedIn || !prepared.Account.CreatorVerified {
			return "", errors.New("官方编辑页交接信息未核实，请检查专用浏览器")
		}
		delete(a.douyinPreviews, p.ID)
		if err = a.setDouyinState(j, "manual_review", ""); err != nil {
			return "", err
		}
		return "自动核对未完成，已保留官方编辑页。请在弹出的抖音页面核对上传进度、内容和可见范围后继续。工作台尚未确认上传完成，也没有点击发布。", nil
	}
	if !prepared.Verified || prepared.PreparedID == "" || prepared.Account.UserID != d.AccountID || !prepared.Account.LoggedIn || !prepared.Account.CreatorVerified || !strings.HasPrefix(prepared.Image, "data:image/png;base64,") {
		return "", errors.New("官方编辑器预览尚未核实，请检查专用浏览器")
	}
	a.douyinPreviews = map[string]douyinPreview{p.ID: {Token: ID(), ExpiresAt: time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339), Account: prepared.Account, Caption: d.Caption, Title: d.Title, Visibility: d.Visibility, Image: prepared.Image, AssetIDs: p.AssetIDs, CoverID: p.CoverID, PreparedID: prepared.PreparedID, Fingerprint: fingerprint(d), Draft: d}}
	if err = a.setDouyinState(j, "prepared", ""); err != nil {
		delete(a.douyinPreviews, p.ID)
		return "", err
	}
	return "上传完成，请查看预览并确认发布（五分钟内有效）", nil
}
func (a *App) setDouyinState(j domain.Job, state, workID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, e := store.Get[domain.Publication](a.Store.DB, "publications", j.Target)
	if e != nil {
		return e
	}
	if p.OnlineJobID != j.ID {
		return errors.New("任务已失效")
	}
	p.OnlineState = state
	if workID != "" {
		p.RemoteWorkID = workID
		p.PublishedURL = "https://www.douyin.com/video/" + workID
		if p.Kind == "image" {
			p.PublishedURL = "https://www.douyin.com/note/" + workID
		}
	}
	if state == "published" {
		p.PublishedAt = Now()
	}
	return store.Put(a.Store.DB, "publications", p.ID, p)
}
func (a *App) previewDouyin(c *gin.Context) {
	if !a.douyinMu.TryLock() {
		fail(c, 409, "请等待上传完成")
		return
	}
	defer a.douyinMu.Unlock()
	p, ok := a.douyinPreviews[c.Param("id")]
	until, _ := time.Parse(time.RFC3339, p.ExpiresAt)
	if !ok || !time.Now().Before(until) {
		fail(c, 409, "预览不存在或已过期，请重新准备")
		return
	}
	c.JSON(200, p)
}
func (a *App) submitDouyin(c *gin.Context) {
	var req struct {
		Token   string `json:"token"`
		Confirm bool   `json:"confirm"`
	}
	if !bind(c, &req) {
		return
	}
	if !a.douyinMu.TryLock() {
		fail(c, 409, "抖音正在操作，请稍后再试")
		return
	}
	defer a.douyinMu.Unlock()
	v, ok := a.douyinPreviews[c.Param("id")]
	expiry, _ := time.Parse(time.RFC3339, v.ExpiresAt)
	if !req.Confirm || !ok || !time.Now().Before(expiry) || subtle.ConstantTimeCompare([]byte(req.Token), []byte(v.Token)) != 1 {
		fail(c, 409, "确认已失效，请重新准备并核对")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.OnlineState != "prepared" {
		fail(c, 409, "稿件已提交或预览失效")
		return
	}
	d, e := a.douyinDraft(p, v.Account.UserID, v.Visibility)
	if e != nil || fingerprint(d) != v.Fingerprint {
		fail(c, 409, "素材或文案已变动，请重新准备")
		return
	}
	j := newJob("douyin_submit", p.ID, map[string]any{"prepared_id": v.PreparedID, "fingerprint": v.Fingerprint, "expires_at": v.ExpiresAt})
	p.OnlineState = "submitting"
	p.OnlineJobID = j.ID
	p.SubmittedAt = Now()
	if e = a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "jobs", j.ID, j); e != nil {
			return e
		}
		return store.Put(tx, "publications", p.ID, p)
	}); e != nil {
		fail(c, 500, "保存提交任务失败")
		return
	}
	delete(a.douyinPreviews, p.ID)
	c.JSON(202, gin.H{"job_id": j.ID})
}
func (a *App) runDouyinSubmit(j domain.Job) (result string, err error) {
	a.douyinMu.Lock()
	defer a.douyinMu.Unlock()
	markUnknown := false
	// The durable submitting state precedes every possible click. Never retry.
	defer func() {
		if recover() != nil {
			err = errPublishReview
		}
		if err != nil && markUnknown {
			a.setDouyinState(j, "unknown", "")
			err = errors.New(douyinError("unknown"))
		}
	}()
	p, e := store.Get[domain.Publication](a.Store.DB, "publications", j.Target)
	if e != nil {
		return "", e
	}
	if p.OnlineState != "submitting" || p.OnlineJobID != j.ID {
		return "", errors.New("提交记录不匹配")
	}
	markUnknown = true
	d, e := a.douyinDraft(p, p.OnlineAccount, p.Visibility)
	if e != nil {
		return "", e
	}
	if fingerprint(d) != asString(j.Payload["fingerprint"]) {
		return "", errors.New("素材变动")
	}
	until, _ := time.Parse(time.RFC3339, asString(j.Payload["expires_at"]))
	if !time.Now().Before(until) {
		return "", errors.New("确认已过期")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 3*time.Minute)
	defer cancel()
	var receipt struct {
		WorkID string `json:"work_id"`
		State  string `json:"state"`
	}
	if e = a.douyinCall(ctx, "submit", map[string]any{"prepared_id": asString(j.Payload["prepared_id"]), "draft": d}, &receipt); e != nil {
		return "", e
	}
	if !douyinID.MatchString(receipt.WorkID) || (receipt.State != "submitted" && receipt.State != "published" && receipt.State != "rejected") {
		return "", errors.New("缺少可靠作品标识")
	}
	if e = a.setDouyinState(j, receipt.State, receipt.WorkID); e != nil {
		return "", e
	}
	return "已取得作品标识，请查询审核状态", nil
}
func (a *App) recoverDouyin() {
	a.douyinPreviews = nil
	pubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
	for _, p := range pubs {
		if p.TargetPlatform != "douyin" {
			continue
		}
		switch p.OnlineState {
		case "submitting":
			p.OnlineState = "unknown"
		case "prepared", "preparing", "manual_review":
			p.OnlineState = "failed"
		default:
			continue
		}
		store.Put(a.Store.DB, "publications", p.ID, p)
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, j := range jobs {
		if !strings.HasPrefix(j.Kind, "douyin_") || j.State != "queued" && j.State != "running" {
			continue
		}
		j.State = "failed"
		j.Error = "服务已重启，请重新准备"
		if j.Kind == "douyin_submit" {
			j.State = "needs_review"
			j.Error = douyinError("unknown")
		}
		j.UpdatedAt = Now()
		store.Put(a.Store.DB, "jobs", j.ID, j)
	}
}
func (a *App) douyinResult(c *gin.Context) {
	if !a.douyinMu.TryLock() {
		fail(c, 409, "抖音正在操作")
		return
	}
	defer a.douyinMu.Unlock()
	p, ok := a.activePublication(c, c.Param("id"))
	if !ok {
		return
	}
	if p.TargetPlatform != "douyin" || !douyinID.MatchString(p.RemoteWorkID) {
		fail(c, 409, "没有可靠作品 ID，请在官方创作平台核实后手动记录结果")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	var r struct {
		WorkID string `json:"work_id"`
		State  string `json:"state"`
	}
	if e := a.douyinCall(ctx, "result", map[string]any{"work_id": p.RemoteWorkID, "account_id": p.OnlineAccount}, &r); e != nil {
		bad(c, e)
		return
	}
	if r.WorkID != p.RemoteWorkID || (r.State != "published" && r.State != "submitted" && r.State != "rejected") {
		fail(c, 409, "尚未核实到该作品的审核结果")
		return
	}
	if e := a.setDouyinState(domain.Job{ID: p.OnlineJobID, Target: p.ID}, r.State, r.WorkID); e != nil {
		bad(c, e)
		return
	}
	c.JSON(200, r)
}
