// Workbench fork: only local account and publishing endpoints are exposed.
package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

func setupRoutes(s *AppServer) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		if c.GetHeader("Origin") != "" {
			c.AbortWithStatus(403)
			return
		}
		c.Next()
	})
	r.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"app": "xhs-workbench-publisher"}) })
	api := r.Group("/api/v1", authMiddleware(s.authToken))
	api.Use(func(c *gin.Context) { c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20); c.Next() })
	api.GET("/login/status", s.checkLoginStatusHandler)
	api.GET("/login/qrcode", s.getLoginQrcodeHandler)
	api.DELETE("/login/cookies", s.deleteCookiesHandler)
	api.POST("/prepare", s.publishHandler)
	api.POST("/prepare_video", s.publishVideoHandler)
	api.POST("/prepare/editor", s.manualEditorHandler)
	api.DELETE("/prepare/editor", s.manualEditorHandler)
	// Legacy routes also prepare only; they must never automatically submit.
	api.POST("/publish", s.publishHandler)
	api.POST("/publish_video", s.publishVideoHandler)
	api.POST("/monitor/own-notes", s.ownNotesHandler)
	return r
}
