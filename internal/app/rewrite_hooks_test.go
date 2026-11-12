package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestRewriteHooksReachModelAndPersistWithVersions(t *testing.T) {
	a := testApp(t)
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "测试文案", "model": "fixture-model", "base_url": "https://example.com/v1", "secret": "fixture-hook-key"}, 200))
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	for _, mode := range []string{"", "pain", "benefit", "question", "contrast", "story", "plain"} {
		t.Run(mode, func(t *testing.T) {
			expected, rule, err := rewriteHookInstruction(mode)
			if err != nil {
				t.Fatal(err)
			}
			p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "钩子回归"}, 201))
			request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]string{"hook": "invalid", "model_id": m.ID, "requirements": "主题"}, 400)
			queued := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/generate", map[string]any{"hook": mode, "model_id": m.ID, "requirements": "介绍英文学习方法", "tone": "自然分享", "length": "200字", "creative": domain.CreativeSettings{Angle: "备考学生自测词汇"}}, 202))
			j, err := store.Get[domain.Job](a.Store.DB, "jobs", queued["job_id"])
			if err != nil {
				t.Fatal(err)
			}
			if asString(j.Payload["hook"]) != expected {
				t.Fatal("missing frozen hook")
			}
			calls := 0
			http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				var body struct {
					Messages []struct{ Role, Content string }
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if len(body.Messages) != 2 || !strings.Contains(body.Messages[1].Content, rule) || !strings.Contains(body.Messages[1].Content, "自然分享") || !strings.Contains(body.Messages[1].Content, "200字") {
					t.Fatal("writing strategy or user settings missing from model request")
				}
				if !strings.Contains(body.Messages[1].Content, "备考学生自测词汇") {
					t.Fatal("posting angle missing")
				}
				for _, want := range []string{"软件使用者是最终发帖作者", "参考博主的经历不能改写成使用者的经历", "不靠故意错别字", "用户选择专业、正式或其他语气时尊重该选择", "只返回规定的成稿 JSON"} {
					if !strings.Contains(body.Messages[1].Content, want) {
						t.Fatal("default author voice or factual boundary missing from actual request", want)
					}
				}
				raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": `{"title":"学习方法","body":"具体学习步骤。","topics":["英语"]}`}, "finish_reason": "stop"}}})
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
			})
			id, err := a.runRewrite(j)
			if err != nil {
				t.Fatal(err)
			}
			v, err := store.Get[domain.Version](a.Store.DB, "versions", id)
			if v.Creative == nil || v.Creative.Angle != "备考学生自测词汇" {
				t.Fatal("generated version lost angle")
			}
			if err != nil || calls != 1 || v.Hook != expected || !strings.Contains(v.Instructions, rule) {
				t.Fatal("version lost hook or prompt snapshot", err)
			}
			edited := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"parent_id": id, "title": "修改标题", "body": "人工文案", "name": "修改版"}, 201))
			if edited.Hook != expected || edited.ParentID != id {
				t.Fatal("manual child lost generation provenance")
			}
			original, _ := store.Get[domain.Version](a.Store.DB, "versions", id)
			if original.Title != v.Title || original.Hook != expected {
				t.Fatal("manual edit mutated source version")
			}
		})
	}
}
