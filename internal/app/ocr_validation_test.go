package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestOCRImageBytesAndMissingImageReplies(t *testing.T) {
	a := testApp(t)
	asset := sampleImage(t, a)
	f, err := a.openMedia(asset.Path)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := io.ReadAll(f)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	// Incorrect stored MIME must not cause valid local image bytes to be mislabeled.
	asset.MIME = "application/octet-stream"
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	s := a.settings()
	sealed, err := adapter.Seal("ocr-fixture-key")
	if err != nil {
		t.Fatal(err)
	}
	s.OCR = domain.Service{BaseURL: "https://example.com/v1", Model: "qwen3.5-ocr", Secret: sealed}
	store.Put(a.Store.DB, "settings", "services", s)
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	reply := "请提供图片，我才能提取其中的文字内容。"
	calls := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Content []struct {
					Type     string `json:"type"`
					ImageURL struct {
						URL string `json:"url"`
					} `json:"image_url"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "qwen3.5-ocr" || r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer ocr-fixture-key" {
			t.Fatal("wrong OCR contract")
		}
		if len(body.Messages) != 1 || len(body.Messages[0].Content) != 2 {
			t.Fatal("missing multimodal message")
		}
		part := body.Messages[0].Content[0]
		if part.Type != "image_url" || !strings.HasPrefix(part.ImageURL.URL, "data:image/png;base64,") {
			t.Fatal("image not attached as PNG")
		}
		decoded, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(part.ImageURL.URL, "data:image/png;base64,"))
		if e != nil || !bytes.Equal(decoded, expected) {
			t.Fatal("request did not contain actual local image bytes")
		}
		out, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": reply}, "finish_reason": "stop"}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(out)), Header: make(http.Header)}, nil
	})
	for _, text := range []string{reply, "[OCR_IMAGE_UNAVAILABLE]", "请提供图片，我才能提取其中的文字。"} {
		reply = text
		if id, err := a.runOCR(newJob("ocr", asset.ID, nil)); err == nil || id != "" {
			t.Fatal("missing image reply saved as OCR", id, err)
		}
	}
	exs, _ := store.List[domain.Extraction](a.Store.DB, "extractions")
	if len(exs) != 0 {
		t.Fatal("false extraction persisted")
	}
	reply = "真正识别到的文字\n第二行"
	id, err := a.runOCR(newJob("ocr", asset.ID, nil))
	if err != nil {
		t.Fatal(err)
	}
	x, err := store.Get[domain.Extraction](a.Store.DB, "extractions", id)
	if err != nil || x.Text != reply || x.Original != reply || calls != 4 {
		t.Fatal("OCR result or request count incorrect")
	}
	asset.Kind = "video"
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	if _, err = a.runOCR(newJob("ocr", asset.ID, nil)); err == nil || calls != 4 {
		t.Fatal("non-image sent to OCR")
	}
}
