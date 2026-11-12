package adapter

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// Never return provider messages verbatim: they can echo credentials, image data,
// or user content. Only recognized error codes and local recovery advice escape.
func AIStatusError(status int, body io.Reader, model string) error {
	var result struct {
		Code  string `json:"code"`
		Error struct {
			Code string `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(body, 32<<10)).Decode(&result)
	code := result.Error.Code
	if code == "" {
		code = result.Code
	}
	if code == "" {
		code = result.Error.Type
	}
	normalized := strings.NewReplacer("_", "", ".", "", "-", "").Replace(strings.ToLower(code))
	label, hint := "", ""
	switch normalized {
	case "modelnotfound":
		label, hint = "ModelNotFound", "模型不存在或当前账号无权访问。请核对服务商控制台中的模型 ID、地域及开通权限；修改后重新创建规划，不要重试旧任务"
	case "modelnotsupported":
		label, hint = "model_not_supported", "此模型不支持当前兼容接口，请选择支持 Chat Completions 的图片理解模型"
	case "workspacenotfound":
		label, hint = "WorkSpaceNotFound", "工作空间不存在，请检查 API 地址中的工作空间 ID"
	case "invalidapikey", "authenticationerror":
		label, hint = "InvalidApiKey", "密钥无效或与接口地域不匹配，请检查对应服务配置"
	case "accessdenied", "permissiondenied":
		label, hint = "AccessDenied", "账号无权访问此模型，请检查工作空间授权和模型开通状态"
	case "notfound":
		label, hint = "NotFound", "服务未找到资源，请检查 API 基础地址和模型 ID；基础地址不要包含 /chat/completions"
	}
	if hint == "" {
		switch status {
		case 404:
			hint = "未取得可识别的服务商错误码，可能是模型不可用、工作空间无权限或接口路径错误；请核对 API 基础地址、模型 ID 和地域"
		case 401:
			hint = "鉴权失败，请检查 API 密钥及接口地域"
		case 403:
			hint = "服务拒绝访问，请检查模型权限和工作空间授权"
		case 429:
			hint = "请求限流，请稍后手动重试"
		default:
			hint = "AI 服务请求失败，请检查服务配置或稍后手动重试"
		}
	}
	if label != "" {
		label = "，" + label
	}
	return fmt.Errorf("AI 服务 HTTP %d%s（模型 %s）：%s", status, label, model, hint)
}
