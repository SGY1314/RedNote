package app

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Only images explicitly selected by the user receive OCR jobs.
func (a *App) extractImages(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 50 {
		fail(c, 400, "请选择 1 至 50 张图片")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	ids := []string{}
	seen := map[string]bool{}
	for _, id := range req.IDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		asset, ok := get[domain.Asset](a, c, "assets", id)
		if !ok {
			return
		}
		if asset.Kind != "image" || asset.Status != "ready" {
			fail(c, 400, "只能选择已下载完成的图片，尚未提交任何任务")
			return
		}
		ids = append(ids, id)
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "读取任务失败")
		return
	}
	active := map[string]domain.Job{}
	for _, j := range jobs {
		if j.Kind == "ocr" && (j.State == "queued" || j.State == "running") {
			active[j.Target] = j
		}
	}
	result := []string{}
	pending := []domain.Job{}
	for _, id := range ids {
		j, ok := active[id]
		if !ok {
			j = newJob("ocr", id, map[string]any{"trigger": "manual"})
			pending = append(pending, j)
		}
		result = append(result, j.ID)
	}
	if err = a.Store.Transaction(func(tx *sql.Tx) error {
		for _, j := range pending {
			if e := store.Put(tx, "jobs", j.ID, j); e != nil {
				return e
			}
		}
		return nil
	}); err != nil {
		fail(c, 500, "提交提取任务失败")
		return
	}
	c.JSON(202, gin.H{"job_ids": result, "count": len(result)})
}
