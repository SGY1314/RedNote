package app

import (
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type taskProjectResolver struct {
	q     store.Querier
	cache map[string][]byte
}

func taskEntity[T any](r *taskProjectResolver, table, id string) (T, error) {
	var value T
	if id == "" {
		return value, sql.ErrNoRows
	}
	key := table + ":" + id
	raw, found := r.cache[key]
	if !found {
		var data string
		if err := r.q.QueryRow("SELECT data FROM "+table+" WHERE id=?", id).Scan(&data); err != nil {
			r.cache[key] = nil
			return value, err
		}
		raw = []byte(data)
		r.cache[key] = raw
	}
	if raw == nil {
		return value, sql.ErrNoRows
	}
	err := json.Unmarshal(raw, &value)
	return value, err
}
func (r *taskProjectResolver) collection(note domain.Note, revision, item string) *domain.TaskProjectRef {
	name := strings.TrimSpace(note.Title)
	if name == "" {
		name = "未命名笔记"
	}
	return &domain.TaskProjectRef{Category: "collect", ID: note.ID, Name: name, ItemName: item, RevisionID: revision, CurrentRevisionID: note.RevisionID}
}
func (r *taskProjectResolver) resolve(j domain.Job) *domain.TaskProjectRef {
	if j.Kind == "publish" || j.Kind == "export" || strings.HasPrefix(j.Kind, "douyin_") {
		if p, err := taskEntity[domain.Publication](r, "publications", j.Target); err == nil {
			return &domain.TaskProjectRef{Category: "publish", ID: p.ID, Name: p.Title, ItemName: "发布稿"}
		}
		return &domain.TaskProjectRef{Category: "publish", ID: j.Target, Name: "发布项目"}
	}
	if j.Kind == "post_sync" {
		return &domain.TaskProjectRef{Category: "publish", ID: "post-sync:" + j.Target, Name: "帖子数据同步"}
	}
	if j.Kind == "collect" {
		if n, err := taskEntity[domain.Note](r, "notes", j.Result); err == nil {
			return r.collection(n, "", "笔记信息")
		}
		var raw string
		if err := r.q.QueryRow("SELECT data FROM notes WHERE json_extract(data,'$.url')=? LIMIT 1", j.Target).Scan(&raw); err == nil {
			var n domain.Note
			if json.Unmarshal([]byte(raw), &n) == nil {
				return r.collection(n, "", "笔记信息")
			}
		}
		return &domain.TaskProjectRef{Category: "collect", ID: "url:" + sha256Hex(j.Target), Name: "笔记采集", ItemName: "笔记信息"}
	}
	if p, err := taskEntity[domain.Project](r, "projects", j.Target); err == nil {
		return &domain.TaskProjectRef{Category: "rewrite", ID: p.ID, Name: p.Name}
	}
	if asset, err := taskEntity[domain.Asset](r, "assets", j.Target); err == nil {
		if asset.Source == "collection" && asset.RevisionID != "" {
			if rev, e := taskEntity[domain.Revision](r, "revisions", asset.RevisionID); e == nil {
				if n, e := taskEntity[domain.Note](r, "notes", rev.NoteID); e == nil {
					return r.collection(n, asset.RevisionID, asset.Name)
				}
			}
		}
		if p, e := taskEntity[domain.Project](r, "projects", asset.ProjectID); e == nil {
			return &domain.TaskProjectRef{Category: "rewrite", ID: p.ID, Name: p.Name, ItemName: asset.Name}
		}
		return &domain.TaskProjectRef{Category: "collect", ID: asset.RevisionID + ":" + asset.ID, Name: "素材整理", ItemName: asset.Name}
	}
	if strings.HasPrefix(j.Kind, "video") || strings.Contains(j.Kind, "rewrite") || strings.Contains(j.Kind, "plan") || strings.HasPrefix(j.Kind, "angle") || j.Kind == "image_generation" {
		return &domain.TaskProjectRef{Category: "rewrite", ID: j.Target, Name: "仿写项目"}
	}
	return &domain.TaskProjectRef{Category: "collect", ID: j.Target, Name: "素材处理"}
}
func (a *App) listTaskJobs(c *gin.Context) {
	jobs := []domain.Job{}
	err := a.Store.Transaction(func(tx *sql.Tx) error {
		var err error
		jobs, err = store.List[domain.Job](tx, "jobs")
		if err != nil {
			return err
		}
		resolver := taskProjectResolver{q: tx, cache: map[string][]byte{}}
		for i := range jobs {
			jobs[i].TaskProject = resolver.resolve(jobs[i])
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "读取后台任务失败")
		return
	}
	c.JSON(200, jobs)
}
