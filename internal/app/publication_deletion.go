package app

import (
	"database/sql"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) listPublications(c *gin.Context) {
	all, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		fail(c, 500, "读取发布稿失败")
		return
	}
	items := []domain.Publication{}
	for _, p := range all {
		if p.DeletedAt == "" && publicationReplaced(p, all) {
			continue
		}
		if c.Query("include_deleted") == "true" || (p.DeletedAt != "") == (c.Query("deleted") == "true") {
			items = append(items, p)
		}
	}
	c.JSON(200, items)
}

func (a *App) activePublication(c *gin.Context, id string) (domain.Publication, bool) {
	p, ok := get[domain.Publication](a, c, "publications", id)
	if ok && p.DeletedAt != "" {
		fail(c, 409, "发布稿已在回收站，请先恢复")
		return p, false
	}
	if ok {
		all, err := store.List[domain.Publication](a.Store.DB, "publications")
		if err != nil {
			fail(c, 500, "读取发布稿失败")
			return p, false
		}
		if publicationReplaced(p, all) {
			fail(c, 409, "已有更新的发布稿，请重新打开项目核对")
			return p, false
		}
	}
	return p, ok
}

func (a *App) publicationDeletionReady(p domain.Publication, jobs []domain.Job) error {
	for _, job := range jobs {
		if job.Target == p.ID && (job.State == "queued" || job.State == "running") {
			return fmt.Errorf("「%s」仍有任务进行中，请结束后重试", p.Title)
		}
	}
	if p.OnlineState == "queued" || p.OnlineState == "preparing" || p.OnlineState == "submitting" {
		return errors.New("发布任务尚未结束，请先核实任务状态")
	}
	xhs, err := store.Get[mobileHandoffRecord](a.Store.DB, "mobile_handoffs", p.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return errors.New("无法检查手机发布状态")
	}
	if err == nil && activeMobileSession(xhs.Session) {
		return errors.New("手机发布二维码仍有效，请先撤销二维码或等待过期")
	}
	dy, err := store.Get[douyinHandoffRecord](a.Store.DB, "mobile_handoffs", "douyin:"+p.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return errors.New("无法检查手机发布状态")
	}
	if err == nil && dyActive(dy.Session) {
		return errors.New("手机发布二维码仍有效，请先撤销二维码或等待过期")
	}
	return nil
}

func (a *App) trashPublications(c *gin.Context) {
	var req struct {
		IDs     []string `json:"ids"`
		Deleted *bool    `json:"deleted"`
	}
	if !bind(c, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 500 || req.Deleted == nil {
		fail(c, 400, "请选择 1 至 500 份发布稿并指定删除或恢复")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "无法检查发布任务")
		return
	}
	all, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		bad(c, err)
		return
	}
	items := map[string]domain.Publication{}
	// The two platform receipts belong to one draft in the UI. Restore/trash
	// linked receipts together even when an older client sends only one ID.
	req.IDs = linkedPublicationIDs(all, req.IDs)
	for _, id := range req.IDs {
		p, ok := get[domain.Publication](a, c, "publications", id)
		if !ok {
			return
		}
		if *req.Deleted {
			if err := a.publicationDeletionReady(p, jobs); err != nil {
				fail(c, 409, err.Error())
				return
			}
			if p.DeletedAt == "" {
				p.DeletedAt = Now()
			}
		} else {
			if p.DeletedAt != "" && !publicationDraftPublished(p, all) {
				peers := append([]domain.Publication{}, all...)
				for _, restored := range items {
					peers = append(peers, restored)
				}
				for _, other := range peers {
					if other.ID != p.ID && other.DeletedAt == "" && !publicationPublished(other) && other.ProjectID == p.ProjectID && publicationPlatform(other) == publicationPlatform(p) {
						fail(c, 409, "同一项目和平台已有等待发布稿，请先处理当前稿件再恢复旧稿")
						return
					}
				}
			}
			p.DeletedAt = ""
		}
		items[id] = p
	}
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		for id, p := range items {
			if err := store.Put(tx, "publications", id, p); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "操作失败，发布稿未修改")
		return
	}
	c.JSON(200, gin.H{"count": len(items)})
}

func (a *App) purgePublications(c *gin.Context) {
	var req struct {
		IDs     []string `json:"ids"`
		Confirm bool     `json:"confirm"`
	}
	if !bind(c, &req) {
		return
	}
	if !req.Confirm || len(req.IDs) == 0 || len(req.IDs) > 500 {
		fail(c, 400, "请选择 1 至 500 份回收站发布稿并确认彻底删除")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	jobs, err := store.List[domain.Job](a.Store.DB, "jobs")
	if err != nil {
		fail(c, 500, "无法检查发布任务")
		return
	}
	ids := map[string]bool{}
	all, err := store.List[domain.Publication](a.Store.DB, "publications")
	if err != nil {
		bad(c, err)
		return
	}
	req.IDs = linkedPublicationIDs(all, req.IDs)
	for _, id := range req.IDs {
		p, ok := get[domain.Publication](a, c, "publications", id)
		if !ok {
			return
		}
		if p.DeletedAt == "" {
			fail(c, 409, "只能彻底删除回收站中的发布稿")
			return
		}
		if err := a.publicationDeletionReady(p, jobs); err != nil {
			fail(c, 409, err.Error())
			return
		}
		ids[id] = true
	}
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		for id := range ids {
			if err := store.Delete(tx, "publications", id); err != nil {
				return err
			}
			for _, key := range []string{id, "douyin:" + id} {
				if err := store.Delete(tx, "mobile_handoffs", key); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "彻底删除失败，发布稿未修改")
		return
	}
	c.JSON(200, gin.H{"count": len(ids)})
}
