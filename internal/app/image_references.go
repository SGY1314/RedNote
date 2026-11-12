package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"net/url"
	"strings"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type imageReference struct {
	ID     string `json:"id"`
	SHA256 string `json:"sha256"`
}

// Only known official models are inferred; other providers require an explicit protocol choice.
func normalizeImageModel(m *rewriteModel) {
	u, _ := url.Parse(m.BaseURL)
	official := u != nil && (strings.HasSuffix(u.Hostname(), ".aliyuncs.com") || u.Hostname() == "dashscope.aliyuncs.com")
	model := strings.ToLower(m.Model)
	limit := 0
	switch model {
	case "qwen-image-3.0", "qwen-image-3.0-pro":
		limit = 3
	case "qwen-image-2.1-pro", "qwen-image-2.1-turbo":
		limit = 10
	}
	if official && limit > 0 {
		m.Model = model
	}
	if m.ReferenceMode == "" || m.ReferenceMode == "auto" {
		m.ReferenceMode = "none"
		if official && limit > 0 {
			m.ReferenceMode = "generations_image"
		}
	}
	m.ReferenceLimit = 0
	if m.ReferenceMode == "generations_image" {
		m.ReferenceLimit = 3 // conservative default for explicitly compatible providers
		if official && limit > 0 {
			m.ReferenceLimit = limit
		}
	}
}

func (a *App) readImageReference(id, expectedHash string) (imageReference, string, error) {
	fail := func() (imageReference, string, error) {
		return imageReference{}, "", errors.New("参考图片不可用，请确认文件已下载且为有效图片（每张不超过 10 MB，边长不超过 8000，长宽比不超过 10:1）")
	}
	v, err := store.Get[domain.Asset](a.Store.DB, "assets", id)
	if err != nil || v.Kind != "image" || v.Status != "ready" {
		return fail()
	}
	f, err := a.openMedia(v.Path)
	if err != nil {
		return fail()
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, (10<<20)+1))
	if err != nil || len(b) > 10<<20 {
		return fail()
	}
	mime := http.DetectContentType(b)
	if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" && mime != "image/gif" {
		return fail()
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	// WebP dimensions were verified by FFprobe during ingestion. Reuse only
	// when the exact ingested bytes still match, never an arbitrary metadata claim.
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	if mime == "image/webp" && v.SHA256 == hash {
		cfg.Width, cfg.Height, err = v.Width, v.Height, nil
	}
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 8000 || cfg.Height > 8000 || cfg.Width > cfg.Height*10 || cfg.Height > cfg.Width*10 {
		return fail()
	}
	if expectedHash != "" && expectedHash != hash {
		return imageReference{}, "", errors.New("参考图片内容已改变，请重新选择并提交，未调用图片模型")
	}
	return imageReference{ID: id, SHA256: hash}, "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b), nil
}

func jobImageReferences(j domain.Job) ([]imageReference, error) {
	refs := []imageReference{}
	raw, err := json.Marshal(j.Payload["reference_images"])
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(raw, &refs); err != nil {
		return nil, errors.New("参考图片任务快照无效")
	}
	return refs, nil
}

func imagePrompt(prompt, copyText string, count int) string {
	parts := []string{"请生成一张与文案主题一致的配图。"}
	if count > 0 {
		parts = append(parts, fmt.Sprintf("已提供 %d 张参考图，图号按输入顺序排列。参考其主体、风格和构图，结合以下文案和画面要求创作。", count))
	}
	if copyText != "" {
		parts = append(parts, "当前文案：\n"+copyText)
	}
	if prompt != "" {
		parts = append(parts, "画面要求：\n"+prompt)
	}
	return strings.Join(parts, "\n\n")
}
