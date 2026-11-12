package app

import (
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

var automaticAssetName = regexp.MustCompile(`(?i)^(?:[0-9a-f]{16,}(?:[-_][0-9a-z]+)*|[0-9]{8,}(?:[-_][0-9]+)*|(?:screen[ _-]?(?:shot|record(?:ing)?)|screenshot|屏幕截图|屏幕录制|微信图片|微信视频|img|vid|wx_camera)[ _-]*[0-9][0-9_. -]*|(?:生成图片|AI 视频镜头|图片|视频)(?:[ ·_-]*[0-9]+(?:秒)?)?)$`)

func automaticAsset(v domain.Asset) bool {
	if v.NameCustomized || (v.OriginalName != "" && v.Name != v.OriginalName) {
		return false
	}
	name := strings.TrimSpace(v.Name)
	return name == "" || automaticAssetName.MatchString(strings.TrimSuffix(name, filepath.Ext(name)))
}

func assetNameContext(v domain.Asset) string {
	if v.ProjectID != "" {
		return "project:" + v.ProjectID
	}
	if v.RevisionID != "" {
		return "revision:" + v.RevisionID
	}
	return "source:" + v.Source
}

// Presentation only: preserve stored names, file paths and immutable media IDs.
// Ordinals include hidden/deleted assets so removing an item does not renumber others.
func assetPresentations(q store.Querier) (map[string]domain.Asset, error) {
	assets, err := store.List[domain.Asset](q, "assets")
	if err != nil {
		return nil, err
	}
	slices.SortFunc(assets, func(a, b domain.Asset) int {
		if n := strings.Compare(assetNameContext(a), assetNameContext(b)); n != 0 {
			return n
		}
		if n := strings.Compare(a.Kind, b.Kind); n != 0 {
			return n
		}
		if n := strings.Compare(a.CreatedAt, b.CreatedAt); n != 0 {
			return n
		}
		if a.RevisionID != "" && a.RevisionID == b.RevisionID && a.Position != b.Position {
			return a.Position - b.Position
		}
		return strings.Compare(a.ID, b.ID)
	})
	titles := map[string]string{}
	counts := map[string]int{}
	result := map[string]domain.Asset{}
	for _, v := range assets {
		group := assetNameContext(v)
		key := group + ":" + v.Kind
		counts[key]++
		if automaticAsset(v) {
			title, known := titles[group]
			if !known {
				if v.ProjectID != "" {
					if p, e := store.Get[domain.Project](q, "projects", v.ProjectID); e == nil {
						title = p.Name
					}
				} else if v.RevisionID != "" {
					if r, e := store.Get[domain.Revision](q, "revisions", v.RevisionID); e == nil {
						title = r.Title
					}
				}
				titles[group] = title
			}
			if title == "" {
				title = v.ProjectName
			}
			title = strings.Map(func(r rune) rune {
				if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
					return ' '
				}
				return r
			}, title)
			title = strings.Join(strings.Fields(title), " ")
			if runes := []rune(title); len(runes) > 40 {
				title = string(runes[:40])
			}
			label := "图片"
			if v.Kind == "video" {
				label = "视频"
			}
			prefix := "上传"
			if v.Source == "generated" {
				prefix = "生成"
			} else if v.Source == "collection" {
				prefix = "采集"
			}
			name := fmt.Sprintf("%s%s%02d", prefix, label, counts[key])
			if title != "" {
				name = fmt.Sprintf("%s－%s%02d", title, label, counts[key])
			}
			if v.OriginalName == "" {
				v.OriginalName = v.Name
			}
			v.Name = name
		}
		result[v.ID] = v
	}
	return result, nil
}

func (a *App) assetPresentation(v domain.Asset) domain.Asset {
	if names, err := assetPresentations(a.Store.DB); err == nil {
		if presented, ok := names[v.ID]; ok {
			return presented
		}
	}
	return v
}
