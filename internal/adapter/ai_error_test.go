package adapter

import (
	"strings"
	"testing"
)

func TestAIStatusErrorExplains404WithoutLeakingProviderText(t *testing.T) {
	for _, tc := range []struct{ body, want string }{
		{`{"error":{"code":"model_not_found","message":"echo sk-secret and private copy"}}`, "ModelNotFound"},
		{`{"code":"WorkSpaceNotFound","message":"private copy"}`, "工作空间不存在"},
		{`{"error":{"type":"model_not_supported"}}`, "不支持当前兼容接口"},
		{`{"error":{"code":"sk-secret","message":"private copy"}}`, "未取得可识别"},
		{`<html>private copy sk-secret</html>`, "未取得可识别"},
		{strings.Repeat("x", 40000), "未取得可识别"},
	} {
		err := AIStatusError(404, strings.NewReader(tc.body), "qwen3-vl-plus").Error()
		if !strings.Contains(err, tc.want) || !strings.Contains(err, "qwen3-vl-plus") || !strings.Contains(err, "HTTP 404") {
			t.Fatal("missing diagnosis", err)
		}
		if strings.Contains(err, "sk-secret") || strings.Contains(err, "private copy") {
			t.Fatal("provider body leaked")
		}
	}
}
