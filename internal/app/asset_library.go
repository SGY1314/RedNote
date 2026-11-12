package app

import (
	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Promote a cached result in place: no duplicate file, ID, or version changes.
func (a *App) saveAssetToLibrary(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	v, ok := get[domain.Asset](a, c, "assets", c.Param("id"))
	if !ok {
		return
	}
	if v.DeletedAt != "" || v.Status != "ready" {
		fail(c, 409, "素材未就绪或已删除，请先恢复或重试生成结果下载")
		return
	}
	f, err := a.openMedia(v.Path)
	if err != nil {
		fail(c, 409, "本地结果文件不可用，请重试生成结果下载")
		return
	}
	info, err := f.Stat()
	f.Close()
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		fail(c, 409, "本地结果文件不可用，请重试生成结果下载")
		return
	}
	if v.LibraryState == "result" || v.LibraryState == "collected" {
		v.LibraryState, v.UpdatedAt = "saved", Now()
		if err := store.Put(a.Store.DB, "assets", v.ID, v); err != nil {
			fail(c, 500, "保存到素材库失败，请重试")
			return
		}
	}
	c.JSON(200, a.assetPresentation(v))
}
