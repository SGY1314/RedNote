package app

import (
	"database/sql"
	"fmt"
	"github.com/gin-gonic/gin"
	"strings"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func selectedSources(sources []domain.Source, ids []string) []domain.Source {
	result := []domain.Source{}
	for _, id := range ids {
		for _, s := range sources {
			if s.ID == id {
				result = append(result, s)
				break
			}
		}
	}
	return result
}

// Refresh only the extraction text belonging to the project's pinned revision.
// Existing versions and queued generation inputs remain immutable snapshots.
func (a *App) refreshProjectSources(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if p.RevisionID == "" {
		fail(c, 400, "此项目没有来源笔记")
		return
	}
	rev, e := store.Get[domain.Revision](a.Store.DB, "revisions", p.RevisionID)
	if e != nil {
		fail(c, 409, "来源快照不存在")
		return
	}
	exs, e := store.List[domain.Extraction](a.Store.DB, "extractions")
	if e != nil {
		bad(c, e)
		return
	}
	sources := []domain.Source{{ID: "original", Label: "原始笔记", Text: rev.Title + "\n" + rev.Body + "\n" + strings.Join(rev.Topics, " ")}}
	for _, aid := range rev.AssetIDs {
		for _, ex := range exs {
			if ex.AssetID != aid {
				continue
			}
			label := "图片 OCR"
			if ex.Kind == "asr" {
				label = "原视频转写"
			}
			sources = append(sources, domain.Source{ID: ex.ID, Label: fmt.Sprintf("%s · %d", label, len(sources)), Text: ex.Text})
			break
		}
	}
	versions, e := store.List[domain.Version](a.Store.DB, "versions")
	if e != nil {
		bad(c, e)
		return
	}
	e = a.Store.Transaction(func(tx *sql.Tx) error {
		for _, v := range versions {
			if v.ProjectID != p.ID || v.SourceSnapshot != nil {
				continue
			}
			v.SourceSnapshot = []domain.Source{}
			for _, id := range v.SourceIDs {
				for _, source := range p.Sources {
					if id == source.ID {
						v.SourceSnapshot = append(v.SourceSnapshot, source)
					}
				}
			}
			if e := store.Put(tx, "versions", v.ID, v); e != nil {
				return e
			}
		}
		p.Sources = sources
		return store.Put(tx, "projects", p.ID, p)
	})
	if e != nil {
		bad(c, e)
		return
	}
	c.JSON(200, p)
}
