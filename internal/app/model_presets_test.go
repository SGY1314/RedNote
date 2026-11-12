package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

const presetFixture = `{
"rewrite-models":[{"id":"text","name":"文案预设","base_url":"https://example.com/v1","model":"text-model","vision":true}],
"image-models":[{"id":"image","name":"图片预设","base_url":"https://example.com/v1","model":"image-model","reference_mode":"generations_image"}],
"video-models":[{"id":"video","name":"视频预设","base_url":"https://example.com/v1","model":"video-model"}],
"services":{"ocr":{"base_url":"https://example.com/v1","model":"ocr-model"}}
}`

func presetFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "presets.json")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestModelPresetsFirstStartupAndRestart(t *testing.T) {
	path := presetFile(t, presetFixture)
	cfg := Config{DataDir: t.TempDir(), ModelPresets: path}
	a, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"rewrite", "image", "video"} {
		models := decode[[]rewriteModel](t, request(t, a, "GET", "/"+kind+"-models", nil, 200))
		if len(models) != 1 || models[0].Name == "" || models[0].BaseURL != "https://example.com/v1" || models[0].Configured || models[0].Secret != "" || models[0].Mask != "" {
			t.Fatal("preset is missing or contains credentials", kind)
		}
	}
	if s := a.settings(); s.OCR.Model != "ocr-model" || s.OCR.Secret != "" || s.Text.Model != "qwen-plus" {
		t.Fatal("service defaults not merged correctly")
	}
	models, _ := a.rewriteModels()
	models[0].Name = "用户改名"
	models[0].Secret = "existing-encrypted-key"
	if err := store.Put(a.Store.DB, "settings", "rewrite-models", models); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(a.Store.DB, "settings", "image-models", []rewriteModel{}); err != nil {
		t.Fatal(err)
	}
	a.Close()
	// Updating or removing the distribution preset file cannot reset user settings.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	a, err = New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	models, _ = a.rewriteModels()
	images, _ := a.imageModels()
	if models[0].Name != "用户改名" || models[0].Secret != "existing-encrypted-key" || len(images) != 0 {
		t.Fatal("restart overwrote user configuration")
	}
}

func TestModelPresetsDoNotOverwriteExistingCatalogsOrServices(t *testing.T) {
	a := testApp(t)
	existing := domain.Settings{Text: domain.Service{BaseURL: "https://own.example/v1", Model: "own-model", Secret: "encrypted"}}
	if err := store.Put(a.Store.DB, "settings", "services", existing); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(a.Store.DB, "settings", "rewrite-models", []rewriteModel{}); err != nil {
		t.Fatal(err)
	}
	if err := a.installModelPresets(presetFile(t, presetFixture)); err != nil {
		t.Fatal(err)
	}
	models, _ := a.rewriteModels()
	if len(models) != 0 || a.settings().Text.Secret != "encrypted" || a.settings().Text.Model != "own-model" {
		t.Fatal("preset replaced existing data")
	}
}

func TestModelPresetsReceiverOnlyAddsKey(t *testing.T) {
	a := testApp(t)
	if err := a.installModelPresets(presetFile(t, presetFixture)); err != nil {
		t.Fatal(err)
	}
	models, err := a.rewriteModels()
	if err != nil {
		t.Fatal(err)
	}
	input := models[0]
	input.Secret = "receiver-test-key"
	result := decode[rewriteModel](t, request(t, a, "PUT", "/rewrite-models/"+input.ID, input, 200))
	if !result.Configured || result.Secret != "" || result.Name != input.Name || result.BaseURL != input.BaseURL || result.Model != input.Model {
		t.Fatal("receiver could not activate the preset by adding their key")
	}
	models, err = a.rewriteModels()
	if err != nil || models[0].Secret == "" || models[0].Secret == input.Secret {
		t.Fatal("receiver key was not encrypted", err)
	}
}

func TestModelPresetsRejectCredentialsAndInvalidFilesWithoutPartialWrite(t *testing.T) {
	for _, raw := range []string{
		strings.Replace(presetFixture, `"name":"文案预设"`, `"name":"文案预设","secret":"must-not-import"`, 1),
		strings.Replace(presetFixture, "https://example.com/v1", "https://example.com/v1?api_key=must-not-import", 1),
		strings.Replace(presetFixture, `"model":"text-model"`, `"model":""`, 1),
		presetFixture + `{}`,
	} {
		a := testApp(t)
		if err := a.installModelPresets(presetFile(t, raw)); err == nil {
			t.Fatal("invalid preset accepted")
		}
		var count int
		if err := a.Store.DB.QueryRow("SELECT count(*) FROM settings WHERE id IN ('rewrite-models','image-models','video-models','model-presets-installed')").Scan(&count); err != nil || count != 0 {
			t.Fatal("failed import partially wrote data", err)
		}
	}
}
