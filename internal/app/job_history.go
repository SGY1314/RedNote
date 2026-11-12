package app

import (
	"database/sql"
	"errors"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Retain execution records used by generation results and publication recovery.
// History removal affects the drawer only, never the worker queue or assets.
func (a *App) deleteJobHistory(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 10000 {
		fail(c, 400, "请选择要删除的历史记录（最多 10000 条）")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	deleted, active := []string{}, []string{}
	now := Now()
	err := a.Store.Transaction(func(tx *sql.Tx) error {
		seen := map[string]bool{}
		for _, id := range req.IDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			j, err := store.Get[domain.Job](tx, "jobs", id)
			if err != nil {
				return err
			}
			if j.State == "queued" || j.State == "running" {
				active = append(active, id)
				continue
			}
			if j.HistoryDeletedAt == "" {
				j.HistoryDeletedAt = now
				// Preserve the original task's outcome, timestamps and provenance.
				if err := store.Put(tx, "jobs", id, j); err != nil {
					return err
				}
			}
			deleted = append(deleted, id)
		}
		return nil
	})
	if errors.Is(err, sql.ErrNoRows) {
		fail(c, 404, "历史记录不存在")
		return
	}
	if err != nil {
		fail(c, 500, "删除历史记录失败")
		return
	}
	if len(deleted) == 0 && len(active) > 0 {
		fail(c, 409, "进行中的任务不能删除历史记录")
		return
	}
	c.JSON(200, gin.H{"deleted_ids": deleted, "skipped_active_ids": active})
}
