package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type Config struct {
	MobilePublishConfigDir string `json:"mobile_publish_config_dir,omitempty"`
	ModelPresets           string `json:"model_presets,omitempty"`
	BrowserDisabled        bool   `json:"browser_disabled,omitempty"`
	PublicOrigin           string `json:"public_origin,omitempty"`
	Listen                 string `json:"listen"`
	DataDir                string `json:"data_dir"`
	CollectorURL           string `json:"collector_url"`
	WebDir                 string `json:"web_dir"`
	PublisherURL           string `json:"publisher_url"`
}
type App struct {
	douyin         douyinBridge
	douyinMu       sync.Mutex
	douyinPreviews map[string]douyinPreview
	douyinTest     func(context.Context, string, any, any) error
	Store          *store.Store
	Config         Config
	mu             sync.Mutex
	CSRF           string
	SyncEpoch      string
	CollectorToken string
	PublisherToken string
	publisherMu    sync.Mutex
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	StopRequested  chan struct{}
	stopOnce       sync.Once
}

func ID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func Now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func New(cfg Config) (*App, error) {
	if cfg.PublicOrigin != "" {
		u, e := url.Parse(cfg.PublicOrigin)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("公网来源必须是完整的 HTTPS 地址，不含路径或账号")
		}
	}
	for _, p := range []string{"media", "tmp", "exports"} {
		if e := os.MkdirAll(filepath.Join(cfg.DataDir, p), 0700); e != nil {
			return nil, e
		}
	}
	s, e := store.Open(cfg.DataDir)
	if e != nil {
		return nil, e
	}
	ctx, cancel := context.WithCancel(context.Background())
	a := &App{Store: s, Config: cfg, CSRF: ID(), ctx: ctx, cancel: cancel, StopRequested: make(chan struct{})}
	if e = a.installModelPresets(cfg.ModelPresets); e != nil {
		s.DB.Close()
		cancel()
		return nil, e
	}
	if e = a.repairImageProjectLinks(); e != nil {
		s.DB.Close()
		cancel()
		return nil, e
	}
	a.SyncEpoch = ID()
	tokenPath := filepath.Join(cfg.DataDir, "collector.token")
	b, e := os.ReadFile(tokenPath)
	if e != nil {
		b = []byte(ID())
		if e = os.WriteFile(tokenPath, b, 0600); e != nil {
			s.DB.Close()
			cancel()
			return nil, e
		}
	}
	a.CollectorToken = strings.TrimSpace(string(b))
	if a.Config.PublisherURL == "" {
		a.Config.PublisherURL = "http://127.0.0.1:18060"
	}
	publisherTokenPath := filepath.Join(cfg.DataDir, "publisher.token")
	b, e = os.ReadFile(publisherTokenPath)
	if os.IsNotExist(e) {
		b = []byte(ID())
		e = os.WriteFile(publisherTokenPath, b, 0600)
	}
	if e != nil {
		s.DB.Close()
		cancel()
		return nil, e
	}
	a.PublisherToken = strings.TrimSpace(string(b))
	return a, nil
}
func (a *App) Close() {
	a.cancel()
	a.wg.Wait()
	a.douyin.mu.Lock()
	a.douyin.stop()
	a.douyin.mu.Unlock()
	a.Store.DB.Close()
}
func fail(c *gin.Context, status int, msg string) { c.AbortWithStatusJSON(status, gin.H{"error": msg}) }
func bad(c *gin.Context, e error)                 { fail(c, 400, e.Error()) }
func bind(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	if e := c.ShouldBindJSON(v); e != nil {
		fail(c, 400, "请求格式错误")
		return false
	}
	return true
}
func get[T any](a *App, c *gin.Context, table, id string) (T, bool) {
	v, e := store.Get[T](a.Store.DB, table, id)
	if e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			fail(c, 404, "记录不存在")
		} else {
			fail(c, 500, "读取记录失败")
		}
		return v, false
	}
	return v, true
}
func list[T any](a *App, c *gin.Context, table string) {
	v, e := store.List[T](a.Store.DB, table)
	if e != nil {
		fail(c, 500, "读取数据失败")
		return
	}
	c.JSON(200, v)
}
func (a *App) Router() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.MaxMultipartMemory = 8 << 20
	_, port, _ := strings.Cut(a.Config.Listen, ":")
	if port == "" {
		port = "8080"
	}
	allowed := map[string]bool{"127.0.0.1:" + port: true, "localhost:" + port: true}
	r.Use(func(c *gin.Context) {
		if !allowed[c.Request.Host] {
			fail(c, 403, "Host 不允许")
			return
		}
		if o := c.GetHeader("Origin"); o != "" {
			u, e := url.Parse(o)
			if e != nil || !((u.Scheme == "http" && allowed[u.Host]) || (a.Config.PublicOrigin != "" && o == a.Config.PublicOrigin)) {
				fail(c, 403, "Origin 不允许")
				return
			}
		}
		if c.GetHeader("Sec-Fetch-Site") == "cross-site" {
			fail(c, 403, "不接受跨站请求")
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Frame-Options", "DENY")
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.Header("Cache-Control", "no-store")
		}
		if c.Request.Method != "GET" && c.Request.Method != "HEAD" && c.Request.Method != "OPTIONS" {
			if c.GetHeader("X-CSRF-Token") != a.CSRF {
				fail(c, 403, "会话已过期，请刷新页面")
				return
			}
		}
		if a.Config.BrowserDisabled {
			p := c.Request.URL.Path
			if strings.HasPrefix(p, "/api/v1/publisher/") || strings.HasPrefix(p, "/api/v1/platforms/douyin/") || p == "/api/v1/post-monitor/sync" || (strings.HasPrefix(p, "/api/v1/publications/") && (strings.HasSuffix(p, "/publish") || strings.HasSuffix(p, "/publish-prepare") || strings.HasSuffix(p, "/publish-preview") || strings.HasSuffix(p, "/publish-status") || strings.HasSuffix(p, "/open-editor"))) {
				fail(c, 503, "云端扫码登录、抖音采集和自动上传暂未启用；当前可使用 AI 编辑和素材管理")
				return
			}
		}
		c.Next()
	})
	api := r.Group("/api/v1")
	a.mobilePublishRoutes(api)
	api.POST("/shutdown", func(c *gin.Context) {
		if a.Config.PublicOrigin != "" {
			fail(c, 403, "云端服务请通过服务器部署工具重启")
			return
		}
		c.JSON(200, gin.H{"stopping": true})
		a.stopOnce.Do(func() { close(a.StopRequested) })
	})
	api.GET("/health", func(c *gin.Context) {
		notice := ""
		if a.Config.BrowserDisabled {
			notice = "云端工作台：可使用文案编辑、AI 创作和素材管理。扫码登录、抖音采集和自动上传暂未启用；AI 功能需先配置模型密钥。"
		}
		c.JSON(200, gin.H{"status": "ok", "app": "xhs-workbench", "notice": notice})
	})
	api.GET("/session", func(c *gin.Context) { c.JSON(200, gin.H{"csrf_token": a.CSRF}) })
	api.GET("/sync", a.syncChanges)
	a.douyinRoutes(api)
	api.GET("/collections", a.notes)
	api.POST("/collections", a.collect)
	api.POST("/collections/batch-delete", a.deleteNotes)
	api.POST("/collections/batch-restore", a.restoreNotes)
	api.POST("/collections/batch-purge", a.purgeNotes)
	api.POST("/collections/tags/delete", a.deleteCollectionTag)
	api.POST("/collections/:id/purge", a.purgeNotes)
	api.DELETE("/collections/:id", a.deleteNote)
	api.POST("/collections/:id/restore", a.restoreNote)
	api.GET("/collections/:id", a.noteDetail)
	api.PATCH("/collections/:id", a.updateNote)
	api.POST("/collections/:id/recollect", a.recollect)
	api.GET("/rewrites", a.listProjects)
	api.GET("/prompt-presets", a.workflowPromptCatalog)
	api.POST("/rewrites/batch-trash", a.trashProjects)
	api.POST("/rewrites/batch-purge", a.purgeProjects)
	api.POST("/rewrites", a.createProject)
	api.GET("/rewrites/:id", a.projectDetail)
	api.GET("/rewrites/:id/workflow", a.creationWorkflowGet)
	api.POST("/rewrites/:id/workflow/source", a.creationWorkflowSource)
	api.POST("/rewrites/:id/workflow/drafts/:step", a.creationWorkflowDraft)
	api.POST("/rewrites/:id/workflow/account", a.creationWorkflowAccount)
	api.POST("/rewrites/:id/workflow/stage", a.saveWorkflowStage)
	api.POST("/rewrites/:id/titles/generate", a.generateTitles)
	api.POST("/rewrites/:id/titles/confirm", a.confirmTitle)
	api.POST("/rewrites/:id/copies/generate", a.generateCopies)
	api.POST("/rewrites/:id/copies/confirm", a.confirmCopy)
	api.POST("/rewrites/:id/angles/recommend", a.recommendWorkflowAngles)
	api.POST("/rewrites/:id/image-plans/confirm", a.confirmImagePlan)
	api.POST("/rewrites/:id/workflow/release", a.releaseCreationWorkflow)
	for _, cap := range []string{"angle", "title", "copy", "image-plan", "video-script"} {
		api.GET("/"+cap+"-models", a.rewriteModelsGet)
	}
	api.PATCH("/rewrites/:id", a.projectMedia)
	api.POST("/rewrites/:id/refresh-sources", a.refreshProjectSources)
	api.POST("/rewrites/:id/versions", a.saveVersion)
	api.POST("/rewrites/:id/drafts/:kind", a.saveRewriteDraft)
	api.POST("/rewrites/:id/versions/:vid/name", a.renameRewriteVersion)
	api.POST("/rewrites/:id/generate", a.generate)
	api.POST("/rewrites/:id/suggest-angles", func(c *gin.Context) { c.Set("suggest_angles", true); a.generate(c) })
	api.POST("/rewrites/:id/generate-image", a.generateImage)
	api.POST("/rewrites/:id/plan-images", a.planImages)
	api.GET("/rewrites/:id/video/scripts", a.videoScripts)
	api.POST("/rewrites/:id/video/plan", a.planVideo)
	api.POST("/rewrites/:id/video/scripts", a.saveVideoScript)
	api.POST("/rewrites/:id/video/scripts/:sid/confirm", a.confirmVideoScript)
	api.POST("/rewrites/:id/video/scripts/:sid/cancel", a.cancelVideoScript)
	api.POST("/rewrites/:id/video/generate", a.generateVideo)
	api.POST("/rewrites/:id/video/productions/:jid/link", a.linkVideoTask)
	api.POST("/rewrites/:id/video/productions/:jid/compose", a.composeVideo)
	api.GET("/video-models", a.rewriteModelsGet)
	api.POST("/video-models", a.rewriteModelSave)
	api.PUT("/video-models/:mid", a.rewriteModelSave)
	api.POST("/video-models/:mid/test", a.settingsTest)
	api.GET("/image-models", a.rewriteModelsGet)
	api.POST("/image-models", a.rewriteModelSave)
	api.PUT("/image-models/:mid", a.rewriteModelSave)
	api.POST("/image-models/:mid/test", a.settingsTest)
	api.GET("/rewrite-models", a.rewriteModelsGet)
	api.POST("/rewrite-models", a.rewriteModelSave)
	api.PUT("/rewrite-models/:mid", a.rewriteModelSave)
	api.POST("/rewrite-models/:mid/test", a.settingsTest)
	api.POST("/rewrites/:id/versions/:vid/confirm", a.confirmVersion)
	api.GET("/publications", a.listPublications)
	api.POST("/publications/batch-trash", a.trashPublications)
	api.POST("/publications/batch-purge", a.purgePublications)
	api.POST("/publications", a.createPublication)
	api.POST("/publications/:id/confirm", a.confirmPublication)
	api.POST("/publications/confirm", a.confirmPublications)
	api.POST("/publications/preview", a.previewPublications)
	api.POST("/publications/:id/export", a.exportPublication)
	api.GET("/publications/:id/package", a.downloadPackage)
	api.PATCH("/publications/:id", a.markPublished)
	api.POST("/publications/:id/status", a.setPublicationStatus)
	api.POST("/publications/:id/platform", a.ensurePublicationPlatform)
	api.GET("/assets", a.listAssets)
	api.POST("/collections/:id/download-media", a.downloadCollectionMedia)
	api.GET("/assets/:id/preview", a.previewCollectionMedia)
	api.POST("/assets", a.upload)
	api.POST("/assets/:id/save-to-library", a.saveAssetToLibrary)
	api.POST("/assets/batch-extract", a.extractImages)
	api.POST("/publisher/status", a.publisherStatus)
	api.POST("/publisher/qrcode", a.publisherQR)
	api.POST("/publisher/disconnect", a.publisherDisconnect)
	api.GET("/post-monitor", a.listPostMonitor)
	api.POST("/post-monitor/sync", a.syncOwnPosts)
	api.POST("/publications/:id/publish", a.submitPublication)
	api.POST("/publications/:id/resolve", a.resolvePublication)
	api.POST("/publications/:id/open-editor", a.openXHSEditor)
	api.POST("/assets/batch-trash", a.trashAssets)
	api.POST("/assets/batch-purge", a.purgeAssets)
	api.PATCH("/assets/category", a.categorizeAssets)
	api.PATCH("/assets/:id", a.updateAsset)
	api.GET("/assets/:id/file", a.assetFile)
	api.HEAD("/assets/:id/file", a.assetFile)
	api.POST("/assets/:id/extract", a.extractAsset)
	api.PATCH("/extractions/:id", a.editExtraction)
	api.GET("/jobs", a.listTaskJobs)
	api.GET("/jobs/:id", func(c *gin.Context) {
		if v, ok := get[domain.Job](a, c, "jobs", c.Param("id")); ok {
			c.JSON(200, v)
		}
	})
	api.POST("/jobs/:id/retry", a.retryJob)
	api.POST("/rewrites/:id/workflow/video", a.generateWorkflowVideo)
	api.POST("/rewrites/:id/workflow/video-script", a.generateWorkflowVideoScript)
	api.POST("/jobs/history/delete", a.deleteJobHistory)
	api.GET("/profile/default", a.defaultProfileGet)
	api.PUT("/profile/default", a.defaultProfilePut)
	api.GET("/settings", a.settingsGet)
	api.PUT("/settings", a.settingsPut)
	api.POST("/settings/test/:service", a.settingsTest)
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			fail(c, 404, "接口不存在")
			return
		}
		serveFrontend(c, a.Config.WebDir)
	})
	return r
}
func jsonString(v any) string { b, _ := json.Marshal(v); return string(b) }
func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func intQuery(c *gin.Context, k string, d int) int {
	n, e := strconv.Atoi(c.Query(k))
	if e != nil || n < 1 {
		return d
	}
	return n
}

var errConfig = errors.New("待配置：请在设置中填写服务地址、模型和密钥")

func wrap(stage string, e error) error { return fmt.Errorf("%s：%w", stage, e) }
