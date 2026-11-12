package app

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) deleteNote(c *gin.Context)   { a.changeNotesDeleted(c, []string{c.Param("id")}, true) }
func (a *App) restoreNote(c *gin.Context)  { a.changeNotesDeleted(c, []string{c.Param("id")}, false) }
func (a *App) deleteNotes(c *gin.Context)  { a.batchNotesDeleted(c, true) }
func (a *App) restoreNotes(c *gin.Context) { a.batchNotesDeleted(c, false) }
func (a *App) batchNotesDeleted(c *gin.Context, deleted bool) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if !bind(c, &req) {
		return
	}
	a.changeNotesDeleted(c, req.IDs, deleted)
}

// Moving an entry to the recycle bin only changes its visibility. Referenced
// revisions, local files, rewrite versions and publication snapshots stay valid.
func (a *App) changeNotesDeleted(c *gin.Context, ids []string, deleted bool) {
	if len(ids) == 0 || len(ids) > 500 {
		fail(c, 400, "请选择 1 至 500 篇笔记")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	notes := []domain.Note{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		n, ok := get[domain.Note](a, c, "notes", id)
		if !ok {
			return
		}
		if deleted && n.DeletedAt == "" {
			n.DeletedAt = Now()
		}
		if !deleted {
			n.DeletedAt = ""
		}
		notes = append(notes, n)
	}
	if err := a.Store.Transaction(func(tx *sql.Tx) error {
		for _, n := range notes {
			if err := store.Put(tx, "notes", n.ID, n); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		fail(c, 500, "更新采集记录失败")
		return
	}
	c.JSON(200, gin.H{"count": len(notes), "deleted": deleted})
}
