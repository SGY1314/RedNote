package app

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Explicit public-only schema: credentials and account fields are not accepted.
type presetService struct {
	BaseURL string `json:"base_url"`
	Model   string `json:"model"`
}

type presetModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Vision        bool   `json:"vision,omitempty"`
	ReferenceMode string `json:"reference_mode,omitempty"`
	presetService
}

type modelPresets struct {
	Rewrite  []presetModel `json:"rewrite-models"`
	Image    []presetModel `json:"image-models"`
	Video    []presetModel `json:"video-models"`
	Services struct {
		Text presetService `json:"text"`
		OCR  presetService `json:"ocr"`
		ASR  presetService `json:"asr"`
	} `json:"services"`
}

func (s presetService) service() domain.Service {
	return domain.Service{BaseURL: strings.TrimRight(strings.TrimSpace(s.BaseURL), "/"), Model: strings.TrimSpace(s.Model)}
}

func validatePresetService(s presetService, ws bool) error {
	if strings.TrimSpace(s.Model) == "" || len(s.Model) > 200 {
		return errors.New("模型 ID 不能为空或超过 200 字节")
	}
	return adapter.ServiceURL(s.BaseURL, ws)
}

// Called before workers start. A transaction makes installation all-or-nothing;
// existing catalogs (including intentionally empty ones) and keys always win.
func (a *App) installModelPresets(path string) error {
	if path == "" {
		return nil
	}
	const marker = "model-presets-installed"
	var existing string
	err := a.Store.DB.QueryRow("SELECT id FROM settings WHERE id=?", marker).Scan(&existing)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return errors.New("无法读取模型预设文件，请检查 config/model-presets.json")
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 128*1024+1))
	if err != nil || len(raw) > 128*1024 {
		return errors.New("模型预设文件无法读取或超过 128 KB")
	}
	var presets modelPresets
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&presets) != nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("模型预设格式无效：仅允许模型名称、地址、ID 和能力配置，不能包含密钥")
	}
	catalogs := map[string][]presetModel{"rewrite-models": presets.Rewrite, "image-models": presets.Image, "video-models": presets.Video}
	values := map[string]any{}
	for key, models := range catalogs {
		if len(models) > 100 {
			return errors.New("每类模型预设最多 100 项")
		}
		converted := []rewriteModel{}
		seen := map[string]bool{}
		for _, model := range models {
			if model.ID == "" || len(model.ID) > 200 || seen[model.ID] || strings.TrimSpace(model.Name) == "" || len(model.Name) > 200 {
				return errors.New("模型预设的名称或 ID 无效、重复")
			}
			if err := validatePresetService(model.presetService, false); err != nil {
				return fmt.Errorf("模型预设地址或模型 ID 无效：%w", err)
			}
			if model.ReferenceMode != "" && model.ReferenceMode != "auto" && model.ReferenceMode != "none" && model.ReferenceMode != "generations_image" {
				return errors.New("模型预设参考图协议无效")
			}
			seen[model.ID] = true
			converted = append(converted, rewriteModel{ID: model.ID, Name: model.Name, Vision: model.Vision, ReferenceMode: model.ReferenceMode, Service: model.presetService.service()})
		}
		values[key] = converted
	}
	services := a.settings()
	for index, entry := range []struct {
		from presetService
		to   *domain.Service
	}{{presets.Services.Text, &services.Text}, {presets.Services.OCR, &services.OCR}, {presets.Services.ASR, &services.ASR}} {
		if entry.from.BaseURL == "" && entry.from.Model == "" {
			continue
		}
		if err := validatePresetService(entry.from, index == 2); err != nil {
			return fmt.Errorf("提取服务预设无效：%w", err)
		}
		*entry.to = entry.from.service()
	}
	values["services"] = services
	return a.Store.Transaction(func(tx *sql.Tx) error {
		for key, value := range values {
			var id string
			err := tx.QueryRow("SELECT id FROM settings WHERE id=?", key).Scan(&id)
			if err == nil {
				continue
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if err := store.Put(tx, "settings", key, value); err != nil {
				return err
			}
		}
		return store.Put(tx, "settings", marker, map[string]bool{"installed": true})
	})
}
