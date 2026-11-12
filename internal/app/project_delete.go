package app

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) listProjects(c *gin.Context) {
	all, err := store.List[domain.Project](a.Store.DB, "projects")
	if err != nil {
		fail(c, 500, "读取项目失败")
		return
	}
	items := []domain.Project{}
	for _, p := range all {
		if platform := c.Query("platform"); platform != "" && p.Platform != platform {
			continue
		}
		if p.DeletedAt == "" || c.Query("include_deleted") == "true" {
			items = append(items, p)
		}
	}
	c.JSON(200, items)
}

// A project in the recycle bin keeps every version, media selection and source.
// Existing publication snapshots and exports have an independent lifetime.
func (a *App) trashProjects(c *gin.Context) {
	var req struct {
		IDs     []string `json:"ids"`
		Deleted *bool    `json:"deleted"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 500 || req.Deleted == nil {
		fail(c, 400, "请选择 1 至 500 个项目并指定删除或恢复")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	projects := map[string]domain.Project{}
	for _, id := range req.IDs {
		p, ok := get[domain.Project](a, c, "projects", id)
		if !ok {
			return
		}
		if *req.Deleted {
			if p.DeletedAt == "" {
				p.DeletedAt = Now()
			}
		} else {
			p.DeletedAt = ""
		}
		projects[id] = p
	}
	if *req.Deleted {
		jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
		if err != nil {
			fail(c, 500, "无法检查生成任务")
			return
		}
		for _, j := range jobs {
			if p, ok := projects[j.Target]; ok && (j.Kind == "angle_recommend" || j.Kind == "title_rewrite" || j.Kind == "copy_rewrite" || j.Kind == "rewrite" || j.Kind == "angle_suggest" || j.Kind == "image_generation" || j.Kind == "image_plan" || isVideoJob(j.Kind)) && (j.State == "running" || j.State == "queued") {
				fail(c, 409, "本次未删除任何项目。「"+p.Name+"」正在生成内容，请任务结束后重试")
				return
			}
		}
	}
	if err := a.Store.Transaction(func(tx *sql.Tx) error {
		for id, p := range projects {
			if err := store.Put(tx, "projects", id, p); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		fail(c, 500, "项目操作失败，记录未修改")
		return
	}
	c.JSON(200, gin.H{"count": len(projects)})
}

func (a *App) editableProject(c *gin.Context, id string) (domain.Project, bool) {
	p, ok := get[domain.Project](a, c, "projects", id)
	if ok && p.DeletedAt != "" {
		fail(c, 409, "项目已在回收站，请先恢复后再操作")
		return p, false
	}
	return p, ok
}

// Publication content is an independent snapshot. Its project/version IDs remain
// provenance identifiers after the editable project and its versions are removed.
func (a *App) purgeProjects(c *gin.Context) {
	var req struct {
		IDs     []string `json:"ids"`
		Confirm bool     `json:"confirm"`
	}
	if !bind(c, &req) {
		return
	}
	if !req.Confirm || len(req.IDs) == 0 || len(req.IDs) > 500 {
		fail(c, 400, "请选择 1 至 500 个回收站项目并确认彻底删除")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	projects := map[string]domain.Project{}
	for _, id := range req.IDs {
		p, ok := get[domain.Project](a, c, "projects", id)
		if !ok {
			return
		}
		if p.DeletedAt == "" {
			fail(c, 409, "只能彻底删除回收站中的项目，请先移入回收站")
			return
		}
		projects[id] = p
	}
	versions, err := store.List[domain.Version](a.Store.DB, "versions")
	if err != nil {
		fail(c, 500, "无法读取项目版本")
		return
	}
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "无法检查生成任务")
		return
	}
	removeJobs := []string{}
	for _, j := range jobs {
		if p, ok := projects[j.Target]; ok && (j.Kind == "angle_recommend" || j.Kind == "title_rewrite" || j.Kind == "copy_rewrite" || j.Kind == "rewrite" || j.Kind == "angle_suggest" || j.Kind == "image_generation" || j.Kind == "image_plan" || isVideoJob(j.Kind)) {
			if j.State == "queued" || j.State == "running" {
				fail(c, 409, "本次未删除任何项目。「"+p.Name+"」正在生成内容，请任务结束后重试")
				return
			}
			removeJobs = append(removeJobs, j.ID)
		}
	}
	scripts, err := store.List[videoScript](a.Store.DB, "video_scripts")
	if err != nil {
		bad(c, err)
		return
	}
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		for _, s := range scripts {
			if _, ok := projects[s.ProjectID]; ok {
				if err := store.Delete(tx, "video_scripts", s.ID); err != nil {
					return err
				}
			}
		}
		for _, v := range versions {
			if _, ok := projects[v.ProjectID]; ok {
				if err := store.Delete(tx, "versions", v.ID); err != nil {
					return err
				}
			}
		}
		for _, id := range removeJobs {
			if _, err := tx.Exec("DELETE FROM settings WHERE id LIKE 'image-result-%' AND json_extract(data, '$.job_id')=?", id); err != nil {
				return err
			}
			if err := store.Delete(tx, "settings", "video-job-"+id); err != nil {
				return err
			}
			if err := store.Delete(tx, "settings", "video-reference-"+id); err != nil {
				return err
			}
			for _, prefix := range []string{"angle_recommend-job-", "title_rewrite-job-", "copy_rewrite-job-"} {
				if err := store.Delete(tx, "settings", prefix+id); err != nil {
					return err
				}
			}
			if err := store.Delete(tx, "settings", "rewrite-job-"+id); err != nil {
				return err
			}
			if err := store.Delete(tx, "settings", "image-job-"+id); err != nil {
				return err
			}
			if err := store.Delete(tx, "settings", "image-plan-job-"+id); err != nil {
				return err
			}
			if err := store.Delete(tx, "jobs", id); err != nil {
				return err
			}
		}
		for id := range projects {
			for _, table := range []string{"angle_generations", "title_generations", "copy_generations", "image_plans"} {
				if _, err := tx.Exec("DELETE FROM "+table+" WHERE json_extract(data,'$.project_id')=?", id); err != nil {
					return err
				}
			}
			if err := store.Delete(tx, "creation_workflows", id); err != nil {
				return err
			}
			if err := store.Delete(tx, "projects", id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "彻底删除失败，项目未修改")
		return
	}
	c.JSON(200, gin.H{"count": len(projects)})
}
