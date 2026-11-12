package app

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

const (
	sessionCookie = "rn_session"
	csrfCookie    = "rn_csrf"
	sessionTTL    = 7 * 24 * time.Hour
)

type AuthUser struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Role         string `json:"role"`
	Status       string `json:"status"`
	CreatedAt    string `json:"created_at"`
	LastLoginAt  string `json:"last_login_at,omitempty"`
	Note         string `json:"note,omitempty"`
	PasswordHash string `json:"-"`
}

type usageRecord struct {
	ID         string  `json:"id"`
	UserID     string  `json:"user_id"`
	User       string  `json:"user"`
	At         string  `json:"at"`
	Kind       string  `json:"kind"`
	Feature    string  `json:"feature"`
	Model      string  `json:"model"`
	Input      int     `json:"input"`
	Output     int     `json:"output"`
	Total      int     `json:"total"`
	Cost       float64 `json:"cost"`
	State      string  `json:"state"`
	StateLabel string  `json:"stateLabel"`
	JobID      string  `json:"jobID"`
}

type taskRecord struct {
	UserID string     `json:"user_id"`
	User   string     `json:"user"`
	Job    domain.Job `json:"job"`
}

type adminSummary struct {
	ActiveUsers int     `json:"active_users"`
	Calls       int     `json:"calls"`
	Tokens      int     `json:"tokens"`
	Cost        float64 `json:"cost"`
	ActiveTasks int     `json:"active_tasks"`
	FailedTasks int     `json:"failed_tasks"`
}

type MultiApp struct {
	Config Config

	AuthDB *sql.DB
	Model  *App

	usersMu            sync.Mutex
	users              map[string]*App
	routers            map[string]*gin.Engine
	legacyCreatorID    string
	sharedCollectorTok string
	sharedPublisherTok string

	StopRequested chan struct{}
	stopOnce      sync.Once
}

func NewMulti(cfg Config) (*MultiApp, error) {
	authDB, err := openAuthDB(filepath.Join(cfg.DataDir, "auth.sqlite"))
	if err != nil {
		return nil, err
	}
	m := &MultiApp{
		Config:        cfg,
		AuthDB:        authDB,
		users:         map[string]*App{},
		routers:       map[string]*gin.Engine{},
		StopRequested: make(chan struct{}),
	}
	if err := m.seedUsers(); err != nil {
		authDB.Close()
		return nil, err
	}
	modelCfg := cfg
	modelCfg.DataDir = filepath.Join(cfg.DataDir, "server")
	modelApp, err := New(modelCfg)
	if err != nil {
		authDB.Close()
		return nil, err
	}
	m.Model = modelApp
	m.migrateLegacyModelConfig()
	if err := m.Model.initializeStageModels(); err != nil {
		m.Close()
		return nil, err
	}
	m.legacyCreatorID = m.firstActiveCreatorID()
	if b, e := os.ReadFile(filepath.Join(cfg.DataDir, "collector.token")); e == nil {
		m.sharedCollectorTok = strings.TrimSpace(string(b))
	}
	if b, e := os.ReadFile(filepath.Join(cfg.DataDir, "publisher.token")); e == nil {
		m.sharedPublisherTok = strings.TrimSpace(string(b))
	}
	return m, nil
}

func (m *MultiApp) Close() {
	m.usersMu.Lock()
	for _, app := range m.users {
		app.Close()
	}
	m.users = map[string]*App{}
	m.usersMu.Unlock()
	if m.Model != nil {
		m.Model.Close()
	}
	if m.AuthDB != nil {
		m.AuthDB.Close()
	}
}

func openAuthDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); err != nil {
		db.Close()
		return nil, err
	}
	schema := `
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','creator','operator')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at TEXT NOT NULL,
 last_login_at TEXT,
 note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 csrf_token TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL,
 user_agent TEXT,
 ip TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 at TEXT NOT NULL,
 actor_id TEXT,
 actor_name TEXT NOT NULL,
 action TEXT NOT NULL,
 detail TEXT NOT NULL,
 ip TEXT
);
CREATE TABLE IF NOT EXISTS meta (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
`
	if _, err = db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func (m *MultiApp) seedUsers() error {
	var n int
	if err := m.AuthDB.QueryRow("SELECT COUNT(*) FROM users").Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	seed := []struct {
		username, password, display, role, note string
	}{
		{"workbench", "rednote2026", "管理员", "admin", "默认管理员账号"},
		{"user", "user2026", "创作用户", "creator", "默认创作用户"},
		{"operator", "operator2026", "运营账号", "operator", "默认运营账号"},
	}
	for _, item := range seed {
		hash, err := bcrypt.GenerateFromPassword([]byte(item.password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		_, err = m.AuthDB.Exec(
			`INSERT INTO users(id,username,password_hash,display_name,role,status,created_at,note) VALUES(?,?,?,?,?, 'active', ?, ?)`,
			ID(), item.username, string(hash), item.display, item.role, Now(), item.note,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func (m *MultiApp) firstActiveCreatorID() string {
	var id string
	_ = m.AuthDB.QueryRow(
		`SELECT id FROM users WHERE role='creator' AND status='active' ORDER BY created_at LIMIT 1`,
	).Scan(&id)
	return id
}

func (m *MultiApp) migrateLegacyModelConfig() {
	legacyPath := filepath.Join(m.Config.DataDir, "db", "workbench.sqlite")
	if _, err := os.Stat(legacyPath); err != nil {
		return
	}
	var marker string
	if err := m.AuthDB.QueryRow("SELECT value FROM meta WHERE key='legacy_model_migrated'").Scan(&marker); err == nil {
		return
	}
	legacy, err := sql.Open("sqlite", legacyPath)
	if err != nil {
		return
	}
	defer legacy.Close()
	for _, key := range []string{"services", "rewrite-models", "image-models", "video-models", "angle-models", "title-models", "copy-models", "image-plan-models", "video-script-models", workflowPromptsKey} {
		var data string
		if err := legacy.QueryRow("SELECT data FROM settings WHERE id=?", key).Scan(&data); err == nil {
			_, _ = m.Model.Store.DB.Exec(
				"INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
				key,
				data,
			)
		}
	}
	_, _ = m.AuthDB.Exec("INSERT INTO meta(key,value) VALUES('legacy_model_migrated',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", Now())
}

func (m *MultiApp) userApp(userID string) (*App, error) {
	m.usersMu.Lock()
	defer m.usersMu.Unlock()
	if app := m.users[userID]; app != nil {
		return app, nil
	}
	dataDir := filepath.Join(m.Config.DataDir, "users", userID)
	if userID == m.legacyCreatorID {
		dataDir = m.Config.DataDir
	}
	cfg := m.Config
	cfg.DataDir = dataDir
	app, err := New(cfg)
	if err != nil {
		return nil, err
	}
	if m.sharedCollectorTok != "" {
		app.CollectorToken = m.sharedCollectorTok
	}
	if m.sharedPublisherTok != "" {
		app.PublisherToken = m.sharedPublisherTok
	}
	_ = m.applyServerConfig(app)
	m.users[userID] = app
	m.routers[userID] = app.Router()
	app.StartWorkers()
	return app, nil
}

// dispatchWorkspace forwards an authenticated request to the user's workspace.
// The outer application owns session authentication and CSRF validation; the
// workspace router still enforces its own CSRF guard, so translate the session
// token into the workspace token at this boundary instead of weakening it.
func (m *MultiApp) dispatchWorkspace(c *gin.Context, userID string) {
	app, err := m.userApp(userID)
	if err != nil {
		fail(c, 500, "工作区初始化失败")
		return
	}
	m.usersMu.Lock()
	router := m.routers[userID]
	m.usersMu.Unlock()
	if router == nil {
		fail(c, 500, "工作区初始化失败")
		return
	}
	c.Request.Header.Set("X-CSRF-Token", app.CSRF)
	router.ServeHTTP(c.Writer, c.Request)
}

func (m *MultiApp) applyServerConfig(dst *App) error {
	for _, key := range []string{"services", "rewrite-models", "image-models", "video-models", "angle-models", "title-models", "copy-models", "image-plan-models", "video-script-models", workflowPromptsKey} {
		var data string
		err := m.Model.Store.DB.QueryRow("SELECT data FROM settings WHERE id=?", key).Scan(&data)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if _, err = dst.Store.DB.Exec(
			"INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
			key,
			data,
		); err != nil {
			return err
		}
	}
	return nil
}

func (m *MultiApp) propagateServerConfig() {
	m.usersMu.Lock()
	defer m.usersMu.Unlock()
	for _, app := range m.users {
		_ = m.applyServerConfig(app)
	}
}

func randomToken(bytesLen int) string {
	b := make([]byte, bytesLen)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func publicUser(u AuthUser) AuthUser {
	u.PasswordHash = ""
	return u
}

func (m *MultiApp) secureCookies() bool {
	return strings.HasPrefix(m.Config.PublicOrigin, "https://")
}

func (m *MultiApp) setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, token, int(sessionTTL.Seconds()), "/", "", m.secureCookies(), true)
}

func (m *MultiApp) clearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, "", -1, "/", "", m.secureCookies(), true)
}

func (m *MultiApp) setCSRFCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(csrfCookie, token, 3600, "/", "", m.secureCookies(), false)
}

func (m *MultiApp) authenticate(username, password string) (AuthUser, error) {
	var u AuthUser
	err := m.AuthDB.QueryRow(
		`SELECT id,username,password_hash,display_name,role,status,created_at,COALESCE(last_login_at,''),COALESCE(note,'')
		 FROM users WHERE username=? COLLATE NOCASE`,
		strings.TrimSpace(username),
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.DisplayName, &u.Role, &u.Status, &u.CreatedAt, &u.LastLoginAt, &u.Note)
	if err != nil {
		return u, errors.New("用户名或密码错误")
	}
	if u.Status != "active" {
		return u, errors.New("账号已停用，请联系管理员")
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return u, errors.New("用户名或密码错误")
	}
	return u, nil
}

func (m *MultiApp) createSession(user AuthUser, ip, userAgent string) (string, string, error) {
	token := randomToken(32)
	csrf := randomToken(24)
	now := time.Now().UTC()
	_, err := m.AuthDB.Exec(
		`INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_seen_at,user_agent,ip)
		 VALUES(?,?,?,?,?,?,?,?)`,
		sha256Hex(token), user.ID, csrf, now.Format(time.RFC3339), now.Add(sessionTTL).Format(time.RFC3339), now.Format(time.RFC3339), userAgent, ip,
	)
	if err != nil {
		return "", "", err
	}
	return token, csrf, nil
}

func (m *MultiApp) deleteSession(token string) {
	if token == "" {
		return
	}
	_, _ = m.AuthDB.Exec("DELETE FROM sessions WHERE token_hash=?", sha256Hex(token))
}

func (m *MultiApp) sessionFromRequest(c *gin.Context) (AuthUser, string, bool) {
	token, err := c.Cookie(sessionCookie)
	if err != nil || token == "" {
		return AuthUser{}, "", false
	}
	var u AuthUser
	var expires string
	err = m.AuthDB.QueryRow(
		`SELECT u.id,u.username,u.password_hash,u.display_name,u.role,u.status,u.created_at,
		 COALESCE(u.last_login_at,''),COALESCE(u.note,''),s.expires_at
		 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`,
		sha256Hex(token),
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.DisplayName, &u.Role, &u.Status, &u.CreatedAt, &u.LastLoginAt, &u.Note, &expires)
	if err != nil {
		return AuthUser{}, "", false
	}
	if u.Status != "active" {
		m.deleteSession(token)
		return AuthUser{}, "", false
	}
	if expiry, err := time.Parse(time.RFC3339, expires); err != nil || time.Now().After(expiry) {
		m.deleteSession(token)
		return AuthUser{}, "", false
	}
	return u, token, true
}

func (m *MultiApp) sessionCSRF(token string) (string, bool) {
	var csrf string
	if err := m.AuthDB.QueryRow("SELECT csrf_token FROM sessions WHERE token_hash=?", sha256Hex(token)).Scan(&csrf); err != nil {
		return "", false
	}
	return csrf, csrf != ""
}

func (m *MultiApp) validCSRF(c *gin.Context) bool {
	token, err := c.Cookie(sessionCookie)
	if err != nil || token == "" {
		return false
	}
	expected, ok := m.sessionCSRF(token)
	if !ok {
		return false
	}
	supplied := c.GetHeader("X-CSRF-Token")
	return subtle.ConstantTimeCompare([]byte(supplied), []byte(expected)) == 1
}

// Login and local shutdown are reachable before a session exists. Login only
// creates a session after credentials are checked; shutdown is unavailable in
// cloud mode and remains a loopback-only process control endpoint.
func csrfExempt(path string) bool {
	return path == "/api/v1/auth/login" || path == "/api/v1/shutdown"
}

func (m *MultiApp) audit(actor AuthUser, action, detail, ip string) {
	name := actor.DisplayName
	if name == "" {
		name = actor.Username
	}
	_, _ = m.AuthDB.Exec(
		`INSERT INTO audit_logs(at,actor_id,actor_name,action,detail,ip) VALUES(?,?,?,?,?,?)`,
		Now(), actor.ID, name, action, detail, ip,
	)
}

func (m *MultiApp) securityMiddleware(c *gin.Context) {
	_, port, _ := strings.Cut(m.Config.Listen, ":")
	if port == "" {
		port = "8080"
	}
	allowed := map[string]bool{"127.0.0.1:" + port: true, "localhost:" + port: true}
	if !allowed[c.Request.Host] {
		fail(c, 403, "Host 不允许")
		return
	}
	if origin := c.GetHeader("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || !((u.Scheme == "http" && allowed[u.Host]) || (m.Config.PublicOrigin != "" && origin == m.Config.PublicOrigin)) {
			fail(c, 403, "Origin 不允许")
			return
		}
	}
	if c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		fail(c, 403, "不接受跨站请求")
		return
	}
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead && c.Request.Method != http.MethodOptions && !csrfExempt(c.Request.URL.Path) {
		if !m.validCSRF(c) {
			fail(c, 403, "会话已过期，请刷新页面")
			return
		}
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Frame-Options", "DENY")
	if strings.HasPrefix(c.Request.URL.Path, "/api/") {
		c.Header("Cache-Control", "no-store")
	}
	c.Next()
}

func (m *MultiApp) Router() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(m.securityMiddleware)
	api := r.Group("/api/v1")
	api.GET("/health", m.health)
	api.GET("/auth/session", m.authSession)
	api.POST("/auth/login", m.login)
	api.POST("/auth/logout", m.logout)
	api.GET("/auth/me", m.requireSession, m.me)
	api.GET("/billing/price", m.userBillingPrice)
	api.GET("/usage", m.requireSession, m.userUsage)
	admin := api.Group("/admin")
	admin.Use(m.requireAdmin)
	admin.GET("/overview", m.adminOverview)
	admin.GET("/users", m.adminUsersList)
	admin.POST("/users", m.adminUsersCreate)
	admin.PATCH("/users/:id", m.adminUsersUpdate)
	admin.DELETE("/users/:id", m.adminUsersDelete)
	admin.POST("/users/:id/password", m.adminUsersPassword)
	admin.GET("/audit", m.adminAuditList)
	admin.GET("/usage", m.adminUsage)
	admin.GET("/tasks", m.adminTasks)
	admin.GET("/billing", m.adminBillingGet)
	admin.PUT("/billing", m.adminBillingPut)
	admin.GET("/settings", m.adminSettingsGet)
	admin.PUT("/settings", m.adminSettingsPut)
	admin.POST("/settings/test/:service", m.adminSettingsTest)
	admin.GET("/models/:cap", m.adminModelList)
	admin.POST("/models/:cap", m.adminModelSave)
	admin.PUT("/models/:cap/:id", m.adminModelSave)
	admin.DELETE("/models/:cap/:id", m.adminModelDelete)
	admin.POST("/models/:cap/:id/test", m.adminModelTest)
	admin.GET("/prompt-presets", m.adminWorkflowPrompts)
	admin.POST("/prompt-presets", m.adminWorkflowPromptSave)
	admin.PUT("/prompt-presets/:id", m.adminWorkflowPromptSave)
	admin.DELETE("/prompt-presets/:id", m.adminWorkflowPromptDelete)
	r.NoRoute(m.fallback)
	return r
}

func (m *MultiApp) health(c *gin.Context) {
	notice := ""
	if m.Config.BrowserDisabled {
		notice = "云端工作台：可使用文案编辑、AI 创作和素材管理。扫码登录、抖音采集和自动上传暂未启用；AI 功能需先配置模型密钥。"
	}
	c.JSON(200, gin.H{"status": "ok", "app": "xhs-workbench", "notice": notice, "auth_required": true})
}

func (m *MultiApp) authSession(c *gin.Context) {
	token := randomToken(24)
	m.setCSRFCookie(c, token)
	c.JSON(200, gin.H{"csrf_token": token})
}

func (m *MultiApp) login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !bind(c, &req) {
		return
	}
	user, err := m.authenticate(req.Username, req.Password)
	if err != nil {
		fail(c, 401, err.Error())
		return
	}
	token, csrf, err := m.createSession(user, c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		fail(c, 500, "创建登录会话失败")
		return
	}
	m.setSessionCookie(c, token)
	m.setCSRFCookie(c, csrf)
	_, _ = m.AuthDB.Exec("UPDATE users SET last_login_at=? WHERE id=?", Now(), user.ID)
	m.audit(user, "登录", fmt.Sprintf("%s 登录工作台", user.DisplayName), c.ClientIP())
	user.LastLoginAt = Now()
	c.JSON(200, gin.H{"user": publicUser(user), "csrf_token": csrf})
}

func (m *MultiApp) logout(c *gin.Context) {
	user, token, ok := m.sessionFromRequest(c)
	if ok {
		m.deleteSession(token)
		m.audit(user, "退出", fmt.Sprintf("%s 退出工作台", user.DisplayName), c.ClientIP())
	}
	m.clearSessionCookie(c)
	c.JSON(200, gin.H{"logged_out": true})
}

func (m *MultiApp) requireSession(c *gin.Context) {
	user, token, ok := m.sessionFromRequest(c)
	if !ok {
		fail(c, 401, "请先登录")
		c.Abort()
		return
	}
	c.Set("auth_user", user)
	c.Set("auth_token", token)
	c.Next()
}

func (m *MultiApp) requireAdmin(c *gin.Context) {
	user, token, ok := m.sessionFromRequest(c)
	if !ok {
		fail(c, 401, "请先登录")
		c.Abort()
		return
	}
	if user.Role != "admin" {
		fail(c, 403, "需要管理员权限")
		c.Abort()
		return
	}
	c.Set("auth_user", user)
	c.Set("auth_token", token)
	c.Next()
}

func (m *MultiApp) me(c *gin.Context) {
	user, _ := c.Get("auth_user")
	c.JSON(200, gin.H{"user": publicUser(user.(AuthUser))})
}

func (m *MultiApp) sessionOrDispatch(c *gin.Context) {
	_, token, ok := m.sessionFromRequest(c)
	if !ok {
		m.authSession(c)
		return
	}
	csrf, ok := m.sessionCSRF(token)
	if !ok {
		fail(c, 401, "请先登录")
		return
	}
	m.setCSRFCookie(c, csrf)
	c.JSON(200, gin.H{"csrf_token": csrf})
}

func isModelWrite(c *gin.Context) bool {
	if c.Request.Method == "GET" || c.Request.Method == "HEAD" || c.Request.Method == "OPTIONS" {
		return false
	}
	p := c.Request.URL.Path
	return strings.HasPrefix(p, "/api/v1/rewrite-models") ||
		strings.HasPrefix(p, "/api/v1/image-models") ||
		strings.HasPrefix(p, "/api/v1/video-models") ||
		strings.HasPrefix(p, "/api/v1/settings")
}

func (m *MultiApp) fallback(c *gin.Context) {
	p := c.Request.URL.Path
	if strings.HasPrefix(p, "/api/") {
		if p == "/api/v1/session" {
			m.sessionOrDispatch(c)
			return
		}
		if p == "/api/v1/shutdown" {
			if m.Config.PublicOrigin != "" {
				fail(c, 403, "云端服务请通过服务器部署工具重启")
				return
			}
			c.JSON(200, gin.H{"stopping": true})
			m.stopOnce.Do(func() { close(m.StopRequested) })
			return
		}
		user, _, ok := m.sessionFromRequest(c)
		if !ok {
			fail(c, 401, "请先登录")
			return
		}
		if strings.HasPrefix(p, "/api/v1/admin/") {
			fail(c, 404, "接口不存在")
			return
		}
		if isModelWrite(c) {
			fail(c, 403, "模型配置仅可在管理控制台由管理员修改")
			return
		}
		m.dispatchWorkspace(c, user.ID)
		return
	}
	m.serveStatic(c)
}

func (m *MultiApp) serveStatic(c *gin.Context) {
	serveFrontend(c, m.Config.WebDir)
}

type auditRecord struct {
	ID     int64  `json:"id"`
	At     string `json:"at"`
	Actor  string `json:"actor"`
	Action string `json:"action"`
	Detail string `json:"detail"`
	IP     string `json:"ip,omitempty"`
}

func (m *MultiApp) currentUser(c *gin.Context) AuthUser {
	v, _ := c.Get("auth_user")
	if u, ok := v.(AuthUser); ok {
		return u
	}
	return AuthUser{}
}

func (m *MultiApp) listUsers() ([]AuthUser, error) {
	rows, err := m.AuthDB.Query(
		`SELECT id,username,password_hash,display_name,role,status,created_at,COALESCE(last_login_at,''),COALESCE(note,'')
		 FROM users ORDER BY created_at,username`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuthUser{}
	for rows.Next() {
		var u AuthUser
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.DisplayName, &u.Role, &u.Status, &u.CreatedAt, &u.LastLoginAt, &u.Note); err != nil {
			return nil, err
		}
		u.PasswordHash = ""
		out = append(out, u)
	}
	return out, rows.Err()
}

func (m *MultiApp) adminUsersList(c *gin.Context) {
	users, err := m.listUsers()
	if err != nil {
		fail(c, 500, "读取用户失败")
		return
	}
	c.JSON(200, users)
}

func (m *MultiApp) adminUsersCreate(c *gin.Context) {
	var req struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		Note        string `json:"note"`
	}
	if !bind(c, &req) {
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.Username == "" || len(req.Username) > 80 {
		fail(c, 400, "用户名不能为空且不能超过 80 字节")
		return
	}
	if len(req.Password) < 8 {
		fail(c, 400, "密码至少需要 8 个字符")
		return
	}
	if req.Role != "admin" && req.Role != "creator" && req.Role != "operator" {
		fail(c, 400, "用户角色无效")
		return
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(c, 500, "密码加密失败")
		return
	}
	u := AuthUser{
		ID:          ID(),
		Username:    req.Username,
		DisplayName: req.DisplayName,
		Role:        req.Role,
		Status:      "active",
		CreatedAt:   Now(),
		Note:        strings.TrimSpace(req.Note),
	}
	_, err = m.AuthDB.Exec(
		`INSERT INTO users(id,username,password_hash,display_name,role,status,created_at,note) VALUES(?,?,?,?,?,?,?,?)`,
		u.ID, u.Username, string(hash), u.DisplayName, u.Role, u.Status, u.CreatedAt, u.Note,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			fail(c, 409, "用户名已存在")
			return
		}
		fail(c, 500, "创建用户失败")
		return
	}
	m.audit(m.currentUser(c), "新增用户", fmt.Sprintf("%s（%s，%s）", u.DisplayName, u.Username, u.Role), c.ClientIP())
	c.JSON(201, publicUser(u))
}

func (m *MultiApp) adminUsersUpdate(c *gin.Context) {
	id := c.Param("id")
	var target AuthUser
	err := m.AuthDB.QueryRow(`SELECT id,username,password_hash,display_name,role,status,created_at,COALESCE(last_login_at,''),COALESCE(note,'') FROM users WHERE id=?`, id).
		Scan(&target.ID, &target.Username, &target.PasswordHash, &target.DisplayName, &target.Role, &target.Status, &target.CreatedAt, &target.LastLoginAt, &target.Note)
	if err != nil {
		fail(c, 404, "用户不存在")
		return
	}
	var req struct {
		DisplayName *string `json:"display_name"`
		Role        *string `json:"role"`
		Status      *string `json:"status"`
		Note        *string `json:"note"`
	}
	if !bind(c, &req) {
		return
	}
	nextRole := target.Role
	nextStatus := target.Status
	if req.Role != nil {
		if *req.Role != "admin" && *req.Role != "creator" && *req.Role != "operator" {
			fail(c, 400, "用户角色无效")
			return
		}
		nextRole = *req.Role
	}
	if req.Status != nil {
		if *req.Status != "active" && *req.Status != "disabled" {
			fail(c, 400, "用户状态无效")
			return
		}
		nextStatus = *req.Status
	}
	if target.Role == "admin" && target.Status == "active" && (nextRole != "admin" || nextStatus != "active") {
		var admins int
		_ = m.AuthDB.QueryRow("SELECT COUNT(*) FROM users WHERE role='admin' AND status='active'").Scan(&admins)
		if admins <= 1 {
			fail(c, 400, "至少保留一名启用中的管理员")
			return
		}
	}
	display := target.DisplayName
	note := target.Note
	if req.DisplayName != nil {
		display = strings.TrimSpace(*req.DisplayName)
		if display == "" {
			fail(c, 400, "显示名称不能为空")
			return
		}
	}
	if req.Note != nil {
		note = strings.TrimSpace(*req.Note)
	}
	_, err = m.AuthDB.Exec(`UPDATE users SET display_name=?,role=?,status=?,note=? WHERE id=?`, display, nextRole, nextStatus, note, id)
	if err != nil {
		fail(c, 500, "更新用户失败")
		return
	}
	if nextStatus == "disabled" {
		_, _ = m.AuthDB.Exec("DELETE FROM sessions WHERE user_id=?", id)
	}
	m.audit(m.currentUser(c), "更新用户", fmt.Sprintf("%s（%s）角色=%s，状态=%s", display, target.Username, nextRole, nextStatus), c.ClientIP())
	c.JSON(200, gin.H{"updated": true})
}

func (m *MultiApp) adminUsersDelete(c *gin.Context) {
	id := c.Param("id")
	var role, username, status string
	if err := m.AuthDB.QueryRow("SELECT role,username,status FROM users WHERE id=?", id).Scan(&role, &username, &status); err != nil {
		fail(c, 404, "用户不存在")
		return
	}
	// Removing a disabled administrator cannot reduce the number of usable
	// administrator accounts, so only guard deletion of an active one.
	if role == "admin" && status == "active" {
		var admins int
		if err := m.AuthDB.QueryRow("SELECT COUNT(*) FROM users WHERE role='admin' AND status='active'").Scan(&admins); err != nil {
			fail(c, 500, "无法检查管理员账号")
			return
		}
		if admins <= 1 {
			fail(c, 400, "不能删除唯一的管理员账号")
			return
		}
	}
	if _, err := m.AuthDB.Exec("DELETE FROM users WHERE id=?", id); err != nil {
		fail(c, 500, "删除用户失败")
		return
	}
	_, _ = m.AuthDB.Exec("DELETE FROM sessions WHERE user_id=?", id)
	m.audit(m.currentUser(c), "删除用户", username, c.ClientIP())
	c.JSON(200, gin.H{"deleted": true})
}

func (m *MultiApp) adminUsersPassword(c *gin.Context) {
	var req struct {
		Password string `json:"password"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.Password) < 8 {
		fail(c, 400, "密码至少需要 8 个字符")
		return
	}
	id := c.Param("id")
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(c, 500, "密码加密失败")
		return
	}
	res, err := m.AuthDB.Exec("UPDATE users SET password_hash=? WHERE id=?", string(hash), id)
	if err != nil {
		fail(c, 500, "更新密码失败")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(c, 404, "用户不存在")
		return
	}
	current := m.currentUser(c)
	if current.ID == id {
		_, _ = m.AuthDB.Exec("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", id, sha256Hex(c.GetString("auth_token")))
	} else {
		_, _ = m.AuthDB.Exec("DELETE FROM sessions WHERE user_id=?", id)
	}
	m.audit(current, "重置密码", "用户 "+id+" 的登录密码已更新", c.ClientIP())
	c.JSON(200, gin.H{"updated": true})
}

func (m *MultiApp) adminAuditList(c *gin.Context) {
	rows, err := m.AuthDB.Query(`SELECT id,at,actor_name,action,detail,COALESCE(ip,'') FROM audit_logs ORDER BY id DESC LIMIT 300`)
	if err != nil {
		fail(c, 500, "读取操作记录失败")
		return
	}
	defer rows.Close()
	out := []auditRecord{}
	for rows.Next() {
		var item auditRecord
		if err := rows.Scan(&item.ID, &item.At, &item.Actor, &item.Action, &item.Detail, &item.IP); err != nil {
			fail(c, 500, "读取操作记录失败")
			return
		}
		out = append(out, item)
	}
	c.JSON(200, out)
}

func (m *MultiApp) billingPrice() float64 {
	var raw string
	if err := m.AuthDB.QueryRow("SELECT value FROM meta WHERE key='billing_price'").Scan(&raw); err != nil {
		return 0
	}
	var price float64
	_, _ = fmt.Sscanf(raw, "%f", &price)
	if price < 0 {
		return 0
	}
	return price
}

func (m *MultiApp) userBillingPrice(c *gin.Context) {
	c.JSON(200, gin.H{"price_per_1k": m.billingPrice()})
}

func (m *MultiApp) adminBillingGet(c *gin.Context) {
	c.JSON(200, gin.H{"price_per_1k": m.billingPrice()})
}

func (m *MultiApp) adminBillingPut(c *gin.Context) {
	var req struct {
		PricePer1K float64 `json:"price_per_1k"`
	}
	if !bind(c, &req) {
		return
	}
	if req.PricePer1K < 0 || req.PricePer1K > 1000000 {
		fail(c, 400, "Token 单价无效")
		return
	}
	_, err := m.AuthDB.Exec("INSERT INTO meta(key,value) VALUES('billing_price',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", fmt.Sprintf("%.6f", req.PricePer1K))
	if err != nil {
		fail(c, 500, "保存单价失败")
		return
	}
	m.audit(m.currentUser(c), "更新计费单价", fmt.Sprintf("%.6f 元/千 Token", req.PricePer1K), c.ClientIP())
	c.JSON(200, gin.H{"price_per_1k": req.PricePer1K})
}

var usageKindNames = map[string]string{
	"angle_recommend": "发帖角度", "title_rewrite": "标题仿写", "copy_rewrite": "文案仿写",
	"rewrite":          "文案生成",
	"angle_suggest":    "文案生成",
	"image_plan":       "图片规划",
	"image_generation": "图片生成",
	"video_plan":       "视频脚本",
	"video_generate":   "视频生成",
	"video_compose":    "视频合成",
	"ocr":              "图片识别",
	"asr":              "语音转写",
}

var usageDefaults = map[string][2]int{
	"angle_recommend": {1800, 420}, "title_rewrite": {160, 180}, "copy_rewrite": {900, 2100},
	"rewrite":          {900, 700},
	"angle_suggest":    {520, 260},
	"image_plan":       {750, 420},
	"image_generation": {380, 90},
	"video_plan":       {880, 760},
	"video_generate":   {520, 120},
	"video_compose":    {260, 40},
	"ocr":              {680, 150},
	"asr":              {420, 180},
}

func estimateJobUsage(user AuthUser, job domain.Job, price float64) usageRecord {
	defaults := usageDefaults[job.Kind]
	input := defaults[0]
	output := defaults[1]
	if payload, ok := job.Payload["input"].(map[string]any); ok {
		text := asString(payload["copy_text"]) + "\n" + asString(payload["prompt"])
		if strings.TrimSpace(text) != "" {
			input = len([]rune(text))/3 + 24
		}
	}
	if strings.TrimSpace(job.Result) != "" {
		output = len([]rune(job.Result))/3 + 8
	}
	if input < 24 {
		input = 24
	}
	if output < 8 {
		output = 8
	}
	// Worker attempts are not provider receipts; these numbers remain estimates.
	// Never assign consumption to untouched queues or configuration failures.
	if job.State != "succeeded" && (job.Attempts == 0 || job.State == "blocked") {
		input, output = 0, 0
	}
	total := input + output
	stateLabels := map[string]string{
		"queued": "排队中", "running": "进行中", "succeeded": "接口成功",
		"failed": "失败", "blocked": "待配置", "needs_review": "待核实", "cancelled": "已取消",
	}
	model := asString(job.Payload["model_name"])
	if model == "" {
		model = asString(job.Payload["model"])
	}
	if model == "" {
		if payload, ok := job.Payload["input"].(map[string]any); ok {
			model = asString(payload["model_id"])
		}
	}
	if model == "" {
		model = "默认模型"
	}
	return usageRecord{
		ID:      job.ID,
		UserID:  user.ID,
		User:    user.DisplayName,
		At:      job.UpdatedAt,
		Kind:    job.Kind,
		Feature: usageKindNames[job.Kind],
		Model:   model,
		Input:   input,
		Output:  output,
		Total:   total,
		Cost: func() float64 {
			if price > 0 {
				return float64(total) / 1000 * price
			}
			return 0
		}(),
		State:      job.State,
		StateLabel: stateLabels[job.State],
		JobID:      job.ID,
	}
}

func (m *MultiApp) collectAdminData() ([]AuthUser, []usageRecord, []taskRecord, adminSummary) {
	users, _ := m.listUsers()
	price := m.billingPrice()
	usage := []usageRecord{}
	tasks := []taskRecord{}
	summary := adminSummary{}
	for _, user := range users {
		if user.Status == "active" {
			summary.ActiveUsers++
		}
		if user.Status != "active" {
			continue
		}
		app, err := m.userApp(user.ID)
		if err != nil {
			continue
		}
		jobs, err := store.List[domain.Job](app.Store.DB, "jobs")
		if err != nil {
			continue
		}
		for _, job := range jobs {
			if job.HistoryDeletedAt == "" {
				tasks = append(tasks, taskRecord{UserID: user.ID, User: user.DisplayName, Job: job})
				switch job.State {
				case "queued", "running":
					summary.ActiveTasks++
				case "failed", "blocked", "needs_review":
					summary.FailedTasks++
				}
			}
			if _, ok := usageKindNames[job.Kind]; ok {
				record := estimateJobUsage(user, job, price)
				usage = append(usage, record)
				if record.Total > 0 {
					summary.Calls++
				}
				summary.Tokens += record.Total
				summary.Cost += record.Cost
			}
		}
	}
	sort.Slice(usage, func(i, j int) bool { return usage[i].At > usage[j].At })
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].Job.UpdatedAt > tasks[j].Job.UpdatedAt })
	return users, usage, tasks, summary
}

func (m *MultiApp) adminOverview(c *gin.Context) {
	users, usage, tasks, summary := m.collectAdminData()
	c.JSON(200, gin.H{
		"users": users, "usage": usage, "tasks": tasks,
		"summary": summary, "price_per_1k": m.billingPrice(),
	})
}

func (m *MultiApp) adminUsage(c *gin.Context) {
	_, usage, _, summary := m.collectAdminData()
	c.JSON(200, gin.H{"usage": usage, "summary": summary, "price_per_1k": m.billingPrice()})
}

func (m *MultiApp) userUsage(c *gin.Context) {
	user := m.currentUser(c)
	price := m.billingPrice()
	usage := []usageRecord{}
	summary := adminSummary{ActiveUsers: 1}
	app, err := m.userApp(user.ID)
	if err != nil {
		fail(c, 500, "读取用户用量失败，请稍后重试")
		return
	}
	jobs, err := store.List[domain.Job](app.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "读取任务用量失败，请稍后重试")
		return
	}
	if err == nil {
		for _, job := range jobs {
			if _, ok := usageKindNames[job.Kind]; ok {
				record := estimateJobUsage(user, job, price)
				usage = append(usage, record)
				if record.Total > 0 {
					summary.Calls++
				}
				summary.Tokens += record.Total
				summary.Cost += record.Cost
			}
		}
	}
	sort.Slice(usage, func(i, j int) bool { return usage[i].At > usage[j].At })
	c.JSON(200, gin.H{"usage": usage, "summary": summary, "price_per_1k": price})
}

func (m *MultiApp) adminTasks(c *gin.Context) {
	_, _, tasks, summary := m.collectAdminData()
	c.JSON(200, gin.H{"tasks": tasks, "summary": summary})
}

// adminCapability 让后台四个模型入口（列、存、删、测）用同一条解析规则：
// 非法分组一律 404，而不是静默落到 rewrite 目录。
func adminCapability(c *gin.Context) (string, bool) {
	capability, ok := parseModelCapability(c.Param("cap"))
	if !ok {
		fail(c, 404, "模型分组不存在")
		return "", false
	}
	return capability, true
}

func (m *MultiApp) adminModelList(c *gin.Context) {
	capability, ok := adminCapability(c)
	if !ok {
		return
	}
	models, err := m.Model.modelsFor(capability)
	if err != nil {
		fail(c, 500, "读取模型配置失败")
		return
	}
	for i := range models {
		models[i] = publicRewriteModel(models[i])
	}
	c.JSON(200, models)
}

func (m *MultiApp) adminModelSave(c *gin.Context) {
	capability, ok := adminCapability(c)
	if !ok {
		return
	}
	var req modelSaveRequest
	if !bind(c, &req) {
		return
	}
	saved, err := m.Model.saveModelFor(capability, req, c.Param("id"))
	if err != nil {
		failModelError(c, err, "保存模型失败")
		return
	}
	m.propagateServerConfig()
	m.audit(m.currentUser(c), "保存模型配置", fmt.Sprintf("%s / %s", capability, saved.Name), c.ClientIP())
	c.JSON(200, publicRewriteModel(saved))
}

func (m *MultiApp) adminModelTest(c *gin.Context) {
	capability, ok := adminCapability(c)
	if !ok {
		return
	}
	message, err := m.Model.testModelFor(capability, c.Param("id"))
	if err != nil {
		bad(c, err)
		return
	}
	c.JSON(200, gin.H{"message": message})
}

func (m *MultiApp) adminSettingsGet(c *gin.Context) {
	m.Model.settingsGet(c)
}

func (m *MultiApp) adminSettingsPut(c *gin.Context) {
	m.Model.settingsPut(c)
	m.propagateServerConfig()
}

func (m *MultiApp) adminSettingsTest(c *gin.Context) {
	m.Model.settingsTest(c)
}

func (m *MultiApp) adminModelDelete(c *gin.Context) {
	capability, ok := adminCapability(c)
	if !ok {
		return
	}
	removed, err := m.Model.deleteModelFor(capability, c.Param("id"))
	if err != nil {
		failModelError(c, err, "删除模型失败")
		return
	}
	m.propagateServerConfig()
	m.audit(m.currentUser(c), "删除模型配置", fmt.Sprintf("%s / %s", capability, removed.Name), c.ClientIP())
	c.JSON(200, gin.H{"deleted": true, "id": removed.ID})
}
