package app

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

var hashedFrontendAsset = regexp.MustCompile(`-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$`)

func serveFrontend(c *gin.Context, directory string) {
	c.Header("Cache-Control", "no-store")
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.Status(http.StatusMethodNotAllowed)
		return
	}
	base, err := filepath.Abs(directory)
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	target := filepath.Clean(filepath.Join(base, filepath.FromSlash(c.Request.URL.Path)))
	rel, err := filepath.Rel(base, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		c.Status(http.StatusNotFound)
		return
	}
	if info, err := os.Stat(target); err == nil && !info.IsDir() {
		if rel != "index.html" {
			c.Header("Cache-Control", "no-cache")
			if strings.HasPrefix(filepath.ToSlash(rel), "assets/") && hashedFrontendAsset.MatchString(filepath.Base(target)) {
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			}
		}
		if rel == "index.html" {
			clearFrontendConditions(c)
		}
		c.File(target)
		return
	}
	if strings.HasPrefix(filepath.ToSlash(rel), "assets/") || filepath.Ext(target) != "" {
		c.String(http.StatusNotFound, "页面资源不存在，请重新打开工作台")
		return
	}
	index := filepath.Join(base, "index.html")
	if _, err := os.Stat(index); err != nil {
		c.String(http.StatusServiceUnavailable, "请先执行 scripts/setup.ps1 构建前端")
		return
	}
	clearFrontendConditions(c)
	c.File(index)
}

func clearFrontendConditions(c *gin.Context) {
	c.Request.Header.Del("If-Modified-Since")
	c.Request.Header.Del("If-None-Match")
}
