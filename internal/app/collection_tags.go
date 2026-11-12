package app

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"strings"
	"unicode/utf8"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) deleteCollectionTag(c *gin.Context) {
	var req struct {
		Tag string `json:"tag"`
	}
	if !bind(c, &req) {
		return
	}
	tag := strings.TrimSpace(req.Tag)
	if tag == "" || utf8.RuneCountInString(tag) > 40 {
		fail(c, 400, "请输入有效的个人标签")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	count := 0
	err := a.Store.Transaction(func(tx *sql.Tx) error {
		notes, err := store.List[domain.Note](tx, "notes")
		if err != nil {
			return err
		}
		for _, note := range notes {
			clean := []string{}
			for _, value := range note.Tags {
				if value != tag {
					clean = append(clean, value)
				}
			}
			if len(clean) == len(note.Tags) {
				continue
			}
			note.Tags = clean
			if err := store.Put(tx, "notes", note.ID, note); err != nil {
				return err
			}
			count++
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "删除标签失败")
		return
	}
	c.JSON(200, gin.H{"count": count})
}
