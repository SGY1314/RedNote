package app

import (
	"errors"
	"github.com/gin-gonic/gin"
	"reflect"
	"slices"
	"strings"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func sameVersionContent(a, b domain.Version) bool {
	creative := func(v *domain.CreativeSettings) domain.CreativeSettings {
		if v == nil {
			return domain.CreativeSettings{}
		}
		return *v
	}
	return a.Title == b.Title && a.Body == b.Body && slices.Equal(a.Topics, b.Topics) &&
		a.Media != nil && b.Media != nil && a.Media.Kind == b.Media.Kind && a.Media.CoverID == b.Media.CoverID &&
		slices.Equal(a.Media.AssetIDs, b.Media.AssetIDs) && reflect.DeepEqual(creative(a.Creative), creative(b.Creative))
}

func (a *App) requireCompleteVersion(v domain.Version) error {
	if err := a.validateVersionTitle(v); err != nil {
		return err
	}
	if v.Generated {
		return errors.New("试写记录需要先保存为完整版本")
	}
	if strings.TrimSpace(v.Title) == "" || strings.TrimSpace(v.Body) == "" {
		return errors.New("请补充标题和正文")
	}
	if v.Media == nil || len(v.Media.AssetIDs) == 0 {
		return errors.New("请先选择图片或视频，再保存并确认完整版本")
	}
	if err := a.validateVersionMedia(v.Media); err != nil {
		return err
	}
	for _, id := range append(append([]string{}, v.Media.AssetIDs...), v.Media.CoverID) {
		if id == "" {
			continue
		}
		asset, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if err != nil || asset.DeletedAt != "" {
			return errors.New("素材已删除，请恢复素材或重新选择")
		}
		f, err := a.openMedia(asset.Path)
		if err != nil {
			return errors.New("本地素材文件不可用，请重新下载或上传")
		}
		info, err := f.Stat()
		f.Close()
		if err != nil || info.Size() == 0 {
			return errors.New("本地素材文件为空或不可用")
		}
	}
	return nil
}

func (a *App) saveRewriteDraft(c *gin.Context) {
	var req domain.RewriteDraft
	if !bind(c, &req) {
		return
	}
	kind := c.Param("kind")
	if (kind != "image" && kind != "video") || req.Media == nil || req.Media.Kind != kind {
		fail(c, 400, "草稿类型不一致")
		return
	}
	if len([]rune(req.Content.Body)) > 100000 || len(req.Requirements) > 48000 {
		fail(c, 400, "草稿内容过长")
		return
	}
	if err := validateCreative(req.Creative); err != nil {
		bad(c, err)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if p.Drafts == nil {
		p.Drafts = map[string]domain.RewriteDraft{}
	}
	if p.Drafts[kind].Revision != req.Revision {
		fail(c, 409, "草稿已在其他页面更新，当前修改仍留在本页，请刷新页面核对后继续")
		return
	}
	if req.VersionID != "" {
		v, err := store.Get[domain.Version](a.Store.DB, "versions", req.VersionID)
		if err != nil || v.ProjectID != p.ID {
			fail(c, 400, "草稿来源版本不属于当前项目")
			return
		}
	}
	if err := a.validateVersionMedia(req.Media); err != nil {
		bad(c, err)
		return
	}
	req.Revision++
	req.SavedAt = Now()
	p.Drafts[kind] = req
	if err := store.Put(a.Store.DB, "projects", p.ID, p); err != nil {
		fail(c, 500, "后台草稿保存失败")
		return
	}
	c.JSON(200, req)
}

func (a *App) renameRewriteVersion(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if !bind(c, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if len([]rune(req.Name)) > 80 {
		fail(c, 400, "版本名称最多 80 字")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.editableProject(c, c.Param("id")); !ok {
		return
	}
	v, ok := get[domain.Version](a, c, "versions", c.Param("vid"))
	if !ok {
		return
	}
	if v.ProjectID != c.Param("id") || v.Generated {
		fail(c, 400, "请选择当前项目的完整版本")
		return
	}
	v.Name = req.Name
	if err := store.Put(a.Store.DB, "versions", v.ID, v); err != nil {
		fail(c, 500, "重命名失败")
		return
	}
	c.JSON(200, v)
}
