package app

import (
	"encoding/json"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
)

func TestDashscopeImageProtocolIsOfficialOnly(t *testing.T) {
	for _, base := range []string{
		"https://dashscope.aliyuncs.com/compatible-mode/v1",
		"https://dashscope.aliyuncs.com/api/v1",
		"https://dashscope-intl.aliyuncs.com/api/v1",
	} {
		if !isDashscopeService(base) {
			t.Fatalf("official endpoint not detected: %s", base)
		}
	}
	// 自定义供应商不能只靠域名相似就继承原生协议。
	for _, base := range []string{
		"",
		"https://dashscope.aliyuncs.com.evil.test/api/v1",
		"http://dashscope.aliyuncs.com/api/v1",
		"https://example.com/api/v1",
		"https://ws-fixture.cn-beijing.maas.aliyuncs.com/api/v1",
	} {
		if isDashscopeService(base) {
			t.Fatalf("non-official endpoint accepted: %s", base)
		}
	}
}

func TestDashscopeImageEndpointDropsConfiguredPath(t *testing.T) {
	cases := map[string]string{
		"https://dashscope.aliyuncs.com/compatible-mode/v1": "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
		"https://dashscope.aliyuncs.com/api/v1":             "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
		"https://dashscope.aliyuncs.com/":                   "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
	}
	for base, want := range cases {
		if got := dashscopeImageEndpoint(base); got != want {
			t.Fatalf("endpoint for %s = %s, want %s", base, got, want)
		}
	}
}

func TestDashscopeImageBodyConvertsSizeAndKeepsReferenceOrder(t *testing.T) {
	body := dashscopeImageBody("qwen-image-3.0-pro", "海报", []string{"data:image/png;base64,AAA"}, "1024x1536")
	raw, _ := json.Marshal(body)
	var decoded struct {
		Model      string `json:"model"`
		Input      struct {
			Messages []struct {
				Role    string           `json:"role"`
				Content []map[string]any `json:"content"`
			} `json:"messages"`
		} `json:"input"`
		Parameters struct {
			N         int    `json:"n"`
			Size      string `json:"size"`
			Watermark bool   `json:"watermark"`
		} `json:"parameters"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Model != "qwen-image-3.0-pro" || decoded.Parameters.Size != "1024*1536" || decoded.Parameters.N != 1 {
		t.Fatalf("unexpected body %s", raw)
	}
	if decoded.Parameters.Watermark {
		t.Fatal("watermark must stay off")
	}
	content := decoded.Input.Messages[0].Content
	if len(content) != 2 || content[0]["image"] != "data:image/png;base64,AAA" || content[1]["text"] != "海报" {
		t.Fatalf("reference must precede the prompt: %v", content)
	}
}

func TestDashscopeImageBodyOmitsEmptySize(t *testing.T) {
	body := dashscopeImageBody("qwen-image-3.0", "x", nil, "  ")
	if _, ok := body["parameters"].(map[string]any)["size"]; ok {
		t.Fatal("empty size must not be sent")
	}
}

func TestDashscopeImageResultReadsNativeShape(t *testing.T) {
	raw := []byte(`{"output":{"choices":[{"finish_reason":"stop","message":{"content":[{"image":"https://dashscope-a717.oss-accelerate.aliyuncs.com/a.png","type":"image"}],"role":"assistant"}}]},"usage":{"output_image_count":1}}`)
	item, err := dashscopeImageResult(raw)
	if err != nil || item.URL != "https://dashscope-a717.oss-accelerate.aliyuncs.com/a.png" || item.Base64 != "" {
		t.Fatalf("unexpected item %+v %v", item, err)
	}
}

func TestDashscopeImageResultRejectsOpenAIOnlyPayload(t *testing.T) {
	// 把 OpenAI 兼容响应喂给原生解析器必须失败，避免静默产出空图。
	if _, err := dashscopeImageResult([]byte(`{"data":[{"url":"https://example.com/a.png"}]}`)); err == nil {
		t.Fatal("openai payload must not be accepted as native")
	}
}

func TestWanPublicGatewayAcceptsDocumentedModels(t *testing.T) {
	for _, model := range []string{"wanx2.1-t2v-turbo", "wan2.5-t2v-preview", "Wan3.0-Video"} {
		svc, err := normalizeVideoService(domain.Service{BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", Model: model})
		if err != nil {
			t.Fatalf("%s rejected: %v", model, err)
		}
		if svc.BaseURL != "https://dashscope.aliyuncs.com/api/v1" {
			t.Fatalf("%s normalized to %s", model, svc.BaseURL)
		}
		if svc.Model != strings.ToLower(model) {
			t.Fatalf("%s model changed to %s", model, svc.Model)
		}
	}
	regional, err := normalizeVideoService(domain.Service{BaseURL: "https://dashscope-intl.aliyuncs.com/api/v1", Model: "wan2.5-t2v-preview"})
	if err != nil || regional.BaseURL != "https://dashscope-intl.aliyuncs.com/api/v1" {
		t.Fatalf("regional gateway rejected: %+v %v", regional, err)
	}
}

func TestWanPublicGatewayStillRejectsForeignProviders(t *testing.T) {
	for _, svc := range []domain.Service{
		{BaseURL: "https://dashscope.aliyuncs.com/api/v1", Model: "qwen-plus"},
		{BaseURL: "http://dashscope.aliyuncs.com/api/v1", Model: "wanx2.1-t2v-turbo"},
		{BaseURL: "https://dashscope.aliyuncs.com/api/v1/tasks", Model: "wanx2.1-t2v-turbo"},
		{BaseURL: "https://ark.example.com/api/v3", Model: "wanx2.1-t2v-turbo"},
	} {
		if _, err := normalizeVideoService(svc); err == nil {
			t.Fatalf("invalid provider/model accepted: %+v", svc)
		}
	}
}
