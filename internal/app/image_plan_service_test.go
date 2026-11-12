package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
)

func TestImagePlanQwen3JSONRequestAndService404(t *testing.T) {
	a := testApp(t)
	sealed, err := adapter.Seal("fixture-key")
	if err != nil {
		t.Fatal(err)
	}
	svc := domain.Service{BaseURL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", Model: "qwen3-vl-plus", Secret: sealed}
	m := rewriteModel{Service: svc}
	normalizeRewriteVision(&m)
	if !m.Vision {
		t.Fatal("current vision model not recognized")
	}
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "qwen3-vl-plus" || body["enable_thinking"] != false || body["stream"] != false {
			t.Fatal("wrong vision JSON request", body)
		}
		if req.URL.Path != "/compatible-mode/v1/chat/completions" {
			t.Fatal("wrong endpoint")
		}
		return &http.Response{StatusCode: 404, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":{"code":"model_not_found","message":"secret fixture-key"}}`))}, nil
	})
	_, err = a.chat(svc, []any{map[string]string{"role": "user", "content": "JSON"}}, true)
	if err == nil || !strings.Contains(err.Error(), "ModelNotFound") || strings.Contains(err.Error(), "fixture-key") || calls != 1 {
		t.Fatal("lost safe diagnosis or retried", err, calls)
	}
}

func TestImagePlanOmniNormalizesOfficialIDAndThinking(t *testing.T) {
	a := testApp(t)
	sealed, err := adapter.Seal("fixture-key")
	if err != nil {
		t.Fatal(err)
	}
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	for _, official := range []bool{true, false} {
		base := "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
		if !official {
			base = "https://custom.example/v1"
		}
		svc := domain.Service{BaseURL: base, Model: "Qwen3.8-Omni-Flash", Secret: sealed}
		http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
			var body map[string]any
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if official {
				if body["model"] != "qwen3.8-omni-flash" || body["reasoning_effort"] != "none" {
					t.Fatal("official request incorrect")
				}
			} else if body["model"] != "Qwen3.8-Omni-Flash" || body["reasoning_effort"] != nil {
				t.Fatal("custom provider altered")
			}
			if body["enable_thinking"] != nil {
				t.Fatal("VL-specific parameter leaked into Omni request")
			}
			return planReply(`{"scenes":["测试画面"]}`), nil
		})
		if _, err := a.chat(svc, []any{map[string]string{"role": "user", "content": "JSON"}}, true); err != nil {
			t.Fatal(err)
		}
	}
}
