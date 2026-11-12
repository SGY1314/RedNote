package app

import (
	"database/sql"
	"errors"
	"github.com/gin-gonic/gin"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) purgeNotes(c *gin.Context) {
	var req struct {
		IDs     []string `json:"ids"`
		Confirm bool     `json:"confirm"`
	}
	if !bind(c, &req) {
		return
	}
	if c.Param("id") != "" {
		req.IDs = []string{c.Param("id")}
	}
	if !req.Confirm {
		fail(c, 400, "彻底删除不可恢复，请确认后再操作")
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 500 {
		fail(c, 400, "请选择 1 至 500 篇回收站笔记")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	noteIDs, platformIDs, urls := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, id := range req.IDs {
		n, ok := get[domain.Note](a, c, "notes", id)
		if !ok {
			return
		}
		if n.DeletedAt == "" {
			fail(c, 409, "只能彻底删除回收站中的笔记，请先移至回收站")
			return
		}
		noteIDs[id] = true
		platformIDs[n.NoteID] = true
		urls[n.URL] = true
	}
	revisions, e := store.List[domain.Revision](a.Store.DB, "revisions")
	if e != nil {
		fail(c, 500, "无法检查来源引用")
		return
	}
	assets, e := store.List[domain.Asset](a.Store.DB, "assets")
	if e != nil {
		fail(c, 500, "无法检查素材引用")
		return
	}
	projects, e := store.List[domain.Project](a.Store.DB, "projects")
	if e != nil {
		fail(c, 500, "无法检查仿写引用")
		return
	}
	versions, e := store.List[domain.Version](a.Store.DB, "versions")
	if e != nil {
		fail(c, 500, "无法检查版本引用")
		return
	}
	publications, e := store.List[domain.Publication](a.Store.DB, "publications")
	if e != nil {
		fail(c, 500, "无法检查发布稿引用")
		return
	}
	extractions, e := store.List[domain.Extraction](a.Store.DB, "extractions")
	if e != nil {
		fail(c, 500, "无法检查文字提取引用")
		return
	}
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		fail(c, 500, "无法检查后台任务")
		return
	}
	candidateRevisions, candidateAssets, keepRevisions, keepAssets, keepExtractions := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
	keepMedia := func(ids []string, cover string) {
		for _, id := range ids {
			keepAssets[id] = true
		}
		if cover != "" {
			keepAssets[cover] = true
		}
	}
	for _, r := range revisions {
		if noteIDs[r.NoteID] {
			candidateRevisions[r.ID] = true
			urls[r.URL] = true
			for _, id := range r.AssetIDs {
				candidateAssets[id] = true
			}
		}
	}
	for _, p := range projects {
		if p.RevisionID != "" {
			keepRevisions[p.RevisionID] = true
		}
		keepMedia(p.AssetIDs, p.CoverID)
		for _, selection := range p.MediaSelections {
			keepMedia(selection.AssetIDs, selection.CoverID)
		}
		for _, source := range p.Sources {
			keepExtractions[source.ID] = true
		}
	}
	for _, v := range versions {
		for _, id := range v.SourceIDs {
			keepExtractions[id] = true
		}
	}
	for _, p := range publications {
		keepMedia(p.AssetIDs, p.CoverID)
	}
	for _, r := range revisions {
		if !candidateRevisions[r.ID] || keepRevisions[r.ID] {
			keepMedia(r.AssetIDs, "")
		}
	}
	for _, x := range extractions {
		if keepExtractions[x.ID] {
			keepAssets[x.AssetID] = true
		}
	}
	removeAssets, removeRevisions, removeExtractions, removeJobs := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
	paths := []string{}
	for _, asset := range assets {
		if asset.LibraryState == "saved" || (asset.Source == "collection" && asset.LibraryState == "" && asset.Status == "ready") {
			keepAssets[asset.ID] = true
		}
		if candidateRevisions[asset.RevisionID] {
			candidateAssets[asset.ID] = true
		}
		if keepRevisions[asset.RevisionID] {
			keepAssets[asset.ID] = true
		}
		// User uploads have their own lifetime, even when selected by a note.
		if candidateAssets[asset.ID] && !keepAssets[asset.ID] && asset.Source == "collection" {
			removeAssets[asset.ID] = true
			if asset.Path != "" {
				paths = append(paths, asset.Path)
			}
		}
	}
	for id := range candidateRevisions {
		if !keepRevisions[id] {
			removeRevisions[id] = true
		}
	}
	for _, x := range extractions {
		if removeAssets[x.AssetID] {
			removeExtractions[x.ID] = true
		}
	}
	for _, j := range jobs {
		// A running collection may resolve a short URL into this note later.
		if j.Kind == "collect" && (j.State == "running" || j.State == "queued") {
			fail(c, 409, "尚有采集任务未结束，请完成后再彻底删除")
			return
		}
		if (j.Kind == "download" || j.Kind == "ocr" || j.Kind == "asr") && removeAssets[j.Target] {
			if j.State == "running" {
				fail(c, 409, "待删除素材正在下载或提取文字，请任务结束后重试")
				return
			}
			removeJobs[j.ID] = true
		}
		if j.Kind == "collect" {
			related := noteIDs[j.Result] || urls[j.Target] || urls[asString(j.Payload["url"])]
			if match := notePattern.FindStringSubmatch(j.Target); len(match) > 1 && platformIDs[match[1]] {
				related = true
			}
			if related {
				removeJobs[j.ID] = true
			}
		}
	}
	cleanup := newJob("cleanup", ID(), map[string]any{"paths": paths})
	e = a.Store.Transaction(func(tx *sql.Tx) error {
		for table, ids := range map[string]map[string]bool{"notes": noteIDs, "revisions": removeRevisions, "assets": removeAssets, "extractions": removeExtractions, "jobs": removeJobs} {
			for id := range ids {
				if err := store.Delete(tx, table, id); err != nil {
					return err
				}
			}
		}
		if len(paths) > 0 {
			return store.Put(tx, "jobs", cleanup.ID, cleanup)
		}
		return nil
	})
	if e != nil {
		fail(c, 500, "彻底删除失败，记录未修改")
		return
	}
	cleanupID := ""
	if len(paths) > 0 {
		cleanupID = cleanup.ID
	}
	c.JSON(200, gin.H{"count": len(noteIDs), "cleanup_job_id": cleanupID, "removed_assets": len(removeAssets)})
}

// Cleanup is durable: a crash after metadata deletion cannot silently abandon
// file removal. Retry is idempotent and never deletes a still-referenced path.
func (a *App) runCleanup(j domain.Job) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	assets, e := store.List[domain.Asset](a.Store.DB, "assets")
	if e != nil {
		return "", e
	}
	used := map[string]bool{}
	pathKey := func(path string) string {
		key := filepath.Clean(path)
		if runtime.GOOS == "windows" {
			key = strings.ToLower(key)
		}
		return key
	}
	for _, asset := range assets {
		used[pathKey(asset.Path)] = true
	}
	root, e := os.OpenRoot(filepath.Join(a.Config.DataDir, "media"))
	if e != nil {
		return "", errors.New("无法打开素材目录，请检查权限后重试清理")
	}
	defer root.Close()
	var paths []string
	switch v := j.Payload["paths"].(type) {
	case []string:
		paths = v
	case []any:
		for _, p := range v {
			s, ok := p.(string)
			if !ok {
				return "", errors.New("清理路径格式错误")
			}
			paths = append(paths, s)
		}
	default:
		return "", errors.New("清理任务格式错误")
	}
	for _, path := range paths {
		if !filepath.IsLocal(path) || filepath.Clean(path) == "." {
			return "", errors.New("清理路径未通过安全检查")
		}
		if used[pathKey(path)] {
			continue
		}
		info, err := root.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return "", errors.New("无法检查待清理素材，请稍后重试")
		}
		if info.IsDir() {
			return "", errors.New("清理目标不是素材文件")
		}
		if err = root.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", errors.New("素材文件暂时无法删除，可能被占用；请关闭预览后重试清理")
		}
	}
	return "未引用素材已清理", nil
}
