package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-rod/rod"
	"github.com/xpzouying/xiaohongshu-mcp/browser"
	"github.com/xpzouying/xiaohongshu-mcp/configs"
)

// Editors outlive preparation requests. Only the user publishes in these windows.
type manualEditor interface {
	activate(context.Context) error
	close()
}

type visibleEditor struct {
	browser *browser.Browser
	page    *rod.Page
}

func (e *visibleEditor) activate(ctx context.Context) error {
	_, err := e.page.Context(ctx).Activate()
	return err
}
func (e *visibleEditor) close() { e.browser.Close() }

type manualEditors struct {
	mu    sync.Mutex
	items map[string]manualEditor
}

func (m *manualEditors) focus(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.items[id]
	if e == nil {
		return fmt.Errorf("editor_missing")
	}
	if err := e.activate(ctx); err != nil {
		e.close()
		delete(m.items, id)
		return fmt.Errorf("editor_missing")
	}
	return nil
}

func (m *manualEditors) close(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, e := range m.items {
		if id == "" || key == id {
			e.close()
			delete(m.items, key)
		}
	}
}

func (s *XiaohongshuService) prepareInEditor(ctx context.Context, id, account string, fill func(*rod.Page) error) error {
	if id == "" {
		return fmt.Errorf("缺少预发布编辑器标识")
	}
	s.editors.mu.Lock()
	if s.editors.items[id] != nil {
		s.editors.mu.Unlock()
		return fmt.Errorf("已有预发布窗口，请先预览或确认未发布后重新准备")
	}
	s.editors.mu.Unlock()
	// A visible, dedicated browser is required even when background jobs use headless mode.
	b := browser.NewBrowser(false, browser.WithProxy(configs.Proxy()))
	retained := false
	defer func() {
		if !retained {
			b.Close()
		}
	}()
	page := b.NewPage()
	s.editors.mu.Lock()
	if s.editors.items == nil {
		s.editors.items = map[string]manualEditor{}
	}
	s.editors.items[id] = &visibleEditor{browser: b, page: page}
	retained = true
	s.editors.mu.Unlock()
	// Keep even a partially prepared editor open for inspection/manual completion.
	if err := verifyPublishingAccount(ctx, page, account); err != nil {
		return err
	}
	return fill(page)
}

func (s *AppServer) manualEditorHandler(c *gin.Context) {
	var req struct {
		ID string `json:"editor_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, 400, "INVALID_REQUEST", "缺少编辑器标识", nil)
		return
	}
	service := s.xiaohongshuService
	service.prepareMu.Lock()
	defer service.prepareMu.Unlock()
	if c.Request.Method == "DELETE" {
		service.editors.close(req.ID)
	} else {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		if err := service.editors.focus(ctx, req.ID); err != nil {
			respondError(c, 409, "EDITOR_MISSING", "预发布窗口已关闭，请核实未发布后重新准备", nil)
			return
		}
	}
	respondSuccess(c, gin.H{"ok": true}, "编辑器操作完成")
}
