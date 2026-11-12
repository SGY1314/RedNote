package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type imageSeries struct {
	AssetIDs       []string `json:"asset_ids"`
	Scenes         []string `json:"scenes"`
	Completed      []string `json:"completed"`
	ReferenceLimit int      `json:"reference_limit"`
}

func defaultImageScene(index, count int) string {
	if index == 0 {
		return "开篇：展示故事主体、环境和初始状态，为后续画面建立场景。"
	}
	if index == count-1 {
		return "收尾：承接前面的动作或事件，呈现结果和主题落点。"
	}
	return fmt.Sprintf("发展 %d：沿着文案的叙事顺序推进动作或事件，衔接上一张并为下一张铺垫。", index)
}

func jobImageSeries(j domain.Job) (*imageSeries, error) {
	var series *imageSeries
	raw, err := json.Marshal(j.Payload["series"])
	if err == nil {
		err = json.Unmarshal(raw, &series)
	}
	if err != nil {
		return nil, errors.New("连续画面任务数据无效")
	}
	if series != nil && (len(series.AssetIDs) < 2 || len(series.AssetIDs) > 6 || len(series.Scenes) != len(series.AssetIDs)) {
		return nil, errors.New("连续画面数量与描述不匹配")
	}
	return series, nil
}

// Each successful frame is committed before starting the next paid call.
// Worker recovery never automatically retries a running paid job.
func (a *App) saveImageSeries(j domain.Job, series *imageSeries, stage string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	current, err := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if err != nil {
		return errors.New("无法保存连续画面进度，任务已停止")
	}
	current.Payload["series"] = series
	current.Stage = stage
	current.UpdatedAt = Now()
	return store.Put(a.Store.DB, "jobs", current.ID, current)
}

func (a *App) runImageGeneration(j domain.Job) (string, error) {
	series, err := jobImageSeries(j)
	if err != nil {
		return "", err
	}
	if series == nil {
		return a.runImageFrame(j, j.ID, "")
	}
	latest, err := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if err != nil {
		return "", errors.New("连续画面任务不存在")
	}
	j = latest
	series, err = jobImageSeries(j)
	if err != nil || series == nil {
		return "", errors.New("连续画面任务快照无效")
	}
	refs, err := jobImageReferences(j)
	if err != nil {
		return "", err
	}
	overview := []string{"生成同一个故事的连续画面。保持同一主体的外貌、服装、场景风格、配色和光线一致，动作和情节按以下顺序推进。每次只输出当前编号的一张独立图片，不要拼图、分格漫画或联系表。", "完整画面顺序："}
	if mediaSnapshot(j) != nil {
		overview = []string{"以原图和当前文案为依据，生成视觉协调、各自完整的图片；每次只输出当前编号的一张图片，不要拼图。"}
	}
	for i, scene := range series.Scenes {
		overview = append(overview, fmt.Sprintf("第 %d 张：%s", i+1, scene))
	}
	for i, id := range series.AssetIDs {
		if a.ctx.Err() != nil {
			return "", a.ctx.Err()
		}
		// A completed but subsequently deleted file must not silently trigger a new charge.
		asset, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if e == nil {
			f, e := a.openMedia(asset.Path)
			if e != nil {
				return "", errors.New("本组已完成的图片文件丢失，请恢复文件")
			}
			f.Close()
			if !slices.Contains(series.Completed, id) {
				series.Completed = append(series.Completed, id)
				if e := a.saveImageSeries(j, series, fmt.Sprintf("连续画面已恢复 %d/%d 张", len(series.Completed), len(series.AssetIDs))); e != nil {
					return "", e
				}
			}
			continue
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return "", e
		}
		if slices.Contains(series.Completed, id) {
			return "", errors.New("本组已完成的图片已被删除，请恢复素材；未重新生成已完成画面")
		}
		if err := a.saveImageSeries(j, series, fmt.Sprintf("连续画面：已完成 %d/%d，正在生成第 %d 张", len(series.Completed), len(series.AssetIDs), i+1)); err != nil {
			return "", err
		}
		frame := j
		frame.Payload = make(map[string]any, len(j.Payload))
		for k, v := range j.Payload {
			frame.Payload[k] = v
		}
		frameRefs := append([]imageReference{}, refs...)
		suffix := strings.Join(overview, "\n") + fmt.Sprintf("\n现在只生成第 %d/%d 张：%s", i+1, len(series.AssetIDs), series.Scenes[i])
		// First frame anchors identity throughout the sequence; previous frame adds motion context when capacity permits.
		if mediaSnapshot(j) == nil && i > 0 && asString(j.Payload["reference_mode"]) == "generations_image" {
			if series.ReferenceLimit <= len(frameRefs) {
				return "", errors.New("连续画面缺少首图参考位，请减少来源参考图后重新创建任务")
			}
			anchor, _, e := a.readImageReference(series.AssetIDs[0], "")
			if e != nil {
				return "", fmt.Errorf("第 %d 张未调用模型，首张成图无法用作参考：%w", i+1, e)
			}
			frameRefs = append(frameRefs, anchor)
			suffix += fmt.Sprintf("\n输入参考图 %d 是本组第一张成图，请保持它的主体外貌、服装、色彩和画风，生成当前情节的新画面而非复制首图。", len(frameRefs))
			if i > 1 && len(frameRefs) < series.ReferenceLimit {
				previous, _, e := a.readImageReference(series.AssetIDs[i-1], "")
				if e != nil {
					return "", fmt.Errorf("第 %d 张未调用模型，上一张成图无法用作参考：%w", i+1, e)
				}
				frameRefs = append(frameRefs, previous)
				suffix += fmt.Sprintf("\n输入参考图 %d 是上一张成图，用于衔接动作和场景。", len(frameRefs))
			}
		}
		frame.Payload["reference_images"] = frameRefs
		if _, e := a.runImageFrame(frame, id, suffix); e != nil {
			return "", fmt.Errorf("第 %d/%d 张失败，已保留 %d 张：%w", i+1, len(series.AssetIDs), len(series.Completed), e)
		}
		series.Completed = append(series.Completed, id)
		if err := a.saveImageSeries(j, series, fmt.Sprintf("连续画面已保存 %d/%d 张", len(series.Completed), len(series.AssetIDs))); err != nil {
			return "", err
		}
	}
	return series.AssetIDs[0], nil
}
