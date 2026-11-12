package app

import (
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
)

// DashScope 公网网关只提供原生 AIGC 协议，没有 OpenAI 兼容的
// /images/generations（实测返回 404）。这里只对官方域名启用该分支：
// 自定义供应商即使填了同名模型也不能继承本协议。
var dashscopeHostPattern = regexp.MustCompile(`^dashscope(-[a-z]+)?\.aliyuncs\.com$`)

func isDashscopeService(base string) bool {
	u, err := url.Parse(strings.TrimSpace(base))
	return err == nil && u.Scheme == "https" && dashscopeHostPattern.MatchString(strings.ToLower(u.Hostname()))
}

func dashscopeImageEndpoint(base string) string {
	u, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		return ""
	}
	u.Path = "/api/v1/services/aigc/multimodal-generation/generation"
	u.RawQuery, u.Fragment = "", ""
	return u.String()
}

func dashscopeImageBody(model, prompt string, references []string, size string) map[string]any {
	content := make([]any, 0, len(references)+1)
	for _, reference := range references {
		content = append(content, map[string]any{"image": reference})
	}
	content = append(content, map[string]any{"text": prompt})
	parameters := map[string]any{"n": 1, "watermark": false}
	if s := dashscopeImageSize(size); s != "" {
		parameters["size"] = s
	}
	return map[string]any{
		"model": model,
		"input": map[string]any{"messages": []any{
			map[string]any{"role": "user", "content": content},
		}},
		"parameters": parameters,
	}
}

// DashScope 用「1024*1024」，项目其余配置沿用「1024x1024」。
func dashscopeImageSize(size string) string {
	s := strings.TrimSpace(size)
	if s == "" {
		return ""
	}
	return strings.NewReplacer("x", "*", "X", "*", "×", "*").Replace(s)
}

func dashscopeImageResult(raw []byte) (generatedImageItem, error) {
	var response struct {
		Output struct {
			Choices []struct {
				Message struct {
					Content []struct {
						Image string `json:"image"`
					} `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return generatedImageItem{}, err
	}
	for _, choice := range response.Output.Choices {
		for _, part := range choice.Message.Content {
			if part.Image != "" {
				return generatedImageItem{URL: part.Image}, nil
			}
		}
	}
	return generatedImageItem{}, errors.New("未返回图片")
}
