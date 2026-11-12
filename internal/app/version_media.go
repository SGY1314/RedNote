package app

import (
	"encoding/json"
	"errors"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func versionMedia(p domain.Project) *domain.VersionMedia {
	kind := p.Kind
	if kind == "" {
		kind = "image"
	}
	return &domain.VersionMedia{Kind: kind, AssetIDs: append([]string{}, p.AssetIDs...), CoverID: p.CoverID}
}

func (a *App) validateVersionMedia(m *domain.VersionMedia) error {
	if m == nil {
		return errors.New("此历史版本未记录素材，请先将文案和图片保存为新的整体版本")
	}
	if m.AssetIDs == nil {
		m.AssetIDs = []string{}
	}
	if m.Kind != "image" && m.Kind != "video" {
		return errors.New("请选择图文或视频")
	}
	if m.Kind == "video" && len(m.AssetIDs) > 1 {
		return errors.New("视频版本只能选择一个视频")
	}
	seen := map[string]bool{}
	for _, id := range m.AssetIDs {
		if seen[id] {
			return errors.New("版本素材不能重复")
		}
		seen[id] = true
		asset, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if err != nil || asset.Status != "ready" || asset.Kind != m.Kind {
			return errors.New("版本素材不存在、尚未就绪或类型不匹配")
		}
	}
	if m.CoverID != "" {
		asset, err := store.Get[domain.Asset](a.Store.DB, "assets", m.CoverID)
		if err != nil || asset.Status != "ready" || asset.Kind != "image" {
			return errors.New("版本封面必须是可用图片")
		}
	}
	return nil
}

// Old jobs and versions deliberately retain nil: their historical selection is unknown.
func jobVersionMedia(j domain.Job) (*domain.VersionMedia, error) {
	var media *domain.VersionMedia
	raw, err := json.Marshal(j.Payload["media"])
	if err == nil {
		err = json.Unmarshal(raw, &media)
	}
	return media, err
}
