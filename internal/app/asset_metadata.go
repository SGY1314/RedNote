package app

import (
	"database/sql"
	"errors"
	"github.com/gin-gonic/gin"
	"strings"
	"unicode"
	"unicode/utf8"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func validCategory(value string) (string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > 40 || strings.ContainsFunc(value, unicode.IsControl) {
		return "", errors.New("分类最多 40 个字，不能包含控制字符")
	}
	return value, nil
}
func validAssetName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || utf8.RuneCountInString(value) > 180 || strings.ContainsAny(value, `<>:"/\|?*`) || strings.ContainsFunc(value, unicode.IsControl) {
		return "", errors.New("素材名称须为 1 至 180 个字，不能包含路径或文件名特殊字符")
	}
	return value, nil
}
func (a *App) updateAsset(c *gin.Context) {
	var req struct {
		Name     *string `json:"name"`
		Category *string `json:"category"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Name == nil && req.Category == nil {
		fail(c, 400, "请填写素材名称或分类")
		return
	}
	var name, category string
	var err error
	if req.Name != nil {
		name, err = validAssetName(*req.Name)
		if err != nil {
			bad(c, err)
			return
		}
	}
	if req.Category != nil {
		category, err = validCategory(*req.Category)
		if err != nil {
			bad(c, err)
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	asset, ok := get[domain.Asset](a, c, "assets", c.Param("id"))
	if !ok {
		return
	}
	if req.Name != nil {
		if asset.OriginalName == "" {
			asset.OriginalName = asset.Name
		}
		asset.Name = name
		asset.NameCustomized = true
	}
	if req.Category != nil {
		asset.Category = category
	}
	asset.UpdatedAt = Now()
	if err = store.Put(a.Store.DB, "assets", asset.ID, asset); err != nil {
		fail(c, 500, "保存素材信息失败")
		return
	}
	c.JSON(200, a.assetPresentation(asset))
}
func (a *App) categorizeAssets(c *gin.Context) {
	var req struct {
		IDs      []string `json:"ids"`
		Category string   `json:"category"`
	}
	if !bind(c, &req) {
		return
	}
	category, err := validCategory(req.Category)
	if err != nil {
		bad(c, err)
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 500 {
		fail(c, 400, "请选择 1 至 500 份素材")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	assets := []domain.Asset{}
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
		asset.Category = category
		asset.UpdatedAt = Now()
		assets = append(assets, asset)
	}
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		for _, asset := range assets {
			if err := store.Put(tx, "assets", asset.ID, asset); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, 500, "保存素材分类失败")
		return
	}
	c.JSON(200, gin.H{"count": len(assets)})
}
