package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"io"
	"net/url"
	"slices"
	"strings"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
	"xhs-workbench/internal/workflow"
)

func (a *App) mobilePublishSnapshot(p domain.Publication) (domain.MiniappHandoffSnapshot, []miniappCloudFile, error) {
	s := domain.MiniappHandoffSnapshot{PublicationID: p.ID, VersionID: p.VersionID, Title: p.Title, Body: p.Body, Topics: append([]string{}, p.Topics...), Media: []domain.MiniappHandoffMedia{}}
	if !mobilePublicationEligible(p) {
		return s, nil, errors.New("手机发布支持尚未发布、素材已就绪的小红书图文或视频稿；请先处理已有桌面发布任务")
	}
	v, err := store.Get[domain.Version](a.Store.DB, "versions", p.VersionID)
	if err != nil || v.Status != "confirmed" || v.ProjectID != p.ProjectID || v.Media == nil || v.Media.Kind != p.Kind || v.Media.CoverID != p.CoverID || !slices.Equal(v.Media.AssetIDs, p.AssetIDs) || v.Title != p.Title || v.Body != p.Body || !slices.Equal(v.Topics, p.Topics) {
		return s, nil, errors.New("发布稿与已确认版本不一致，请重新确认完整版本并建立发布稿")
	}
	ids := append([]string{}, p.AssetIDs...)
	if p.Kind == "image" && p.CoverID != "" {
		if !slices.Contains(ids, p.CoverID) {
			return s, nil, errors.New("封面必须来自当前稿件图片")
		}
		ids = append([]string{p.CoverID}, slices.DeleteFunc(ids, func(id string) bool { return id == p.CoverID })...)
	}
	files := []miniappCloudFile{}
	for _, id := range ids {
		asset, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if err != nil || asset.Status != "ready" || asset.DeletedAt != "" || asset.Kind != p.Kind {
			return s, nil, errors.New("手机发布素材未就绪或不属于当前账号")
		}
		file, err := a.openMedia(asset.Path)
		if err != nil {
			return s, nil, errors.New("手机发布素材文件缺失或路径无效")
		}
		info, statErr := file.Stat()
		limit := int64(20 << 20)
		if p.Kind == "video" {
			limit = 1 << 30
		}
		if statErr != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
			file.Close()
			return s, nil, errors.New("图片须不超过20MiB，单个MP4视频须不超过1GiB")
		}
		hash := sha256.New()
		_, err = io.Copy(hash, file)
		digest := hex.EncodeToString(hash.Sum(nil))
		if err != nil || (asset.SHA256 != "" && !strings.EqualFold(asset.SHA256, digest)) {
			file.Close()
			return s, nil, errors.New("素材内容已改变，请重新上传并确认")
		}
		_, err = file.Seek(0, io.SeekStart)
		media := domain.MiniappHandoffMedia{AssetID: id, Kind: p.Kind, SHA256: digest, PreviewURL: "/api/v1/assets/" + url.PathEscape(id) + "/file", Size: info.Size()}
		if p.Kind == "video" {
			header := make([]byte, 12)
			_, readErr := io.ReadFull(file, header)
			file.Close()
			if err != nil || readErr != nil || string(header[4:8]) != "ftyp" || (asset.MIME != "" && asset.MIME != "video/mp4") {
				return s, nil, errors.New("手机视频发布支持MP4，请先转换视频格式")
			}
			media.MIME, media.Width, media.Height, media.Duration = "video/mp4", asset.Width, asset.Height, asset.Duration
		} else {
			config, format, decodeErr := image.DecodeConfig(file)
			file.Close()
			if err != nil || decodeErr != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 {
				return s, nil, errors.New("手机图文发布目前支持有效的JPEG或PNG图片")
			}
			media.MIME, media.Width, media.Height = "image/"+format, config.Width, config.Height
		}
		path, err := a.mediaPath(asset.Path)
		if err != nil {
			return s, nil, err
		}
		s.Media = append(s.Media, media)
		files = append(files, miniappCloudFile{id: id, path: path})
	}
	s.Fingerprint = workflow.HandoffSnapshotFingerprint(s)
	return s, files, workflow.ValidateHandoffSnapshot(s)
}
