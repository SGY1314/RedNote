package app

import (
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestAngleResponseFormats(t *testing.T) {
	for _, text := range []string{
		"角度一\n角度二\n角度三",
		"角度一\n\n角度二\n\n角度三",
		"可以试试这几个话题：\n1. 角度一\n2. 角度二\n3. 角度三",
		"一、角度一\n二、角度二\n三、角度三",
		"- 角度一\n- 角度二\n- 角度三",
		"话题1：角度一\n话题2：角度二\n话题3：角度三",
		`{"angles":["角度一","角度二","角度三"]}`,
		`["角度一","角度二","角度三"]`,
		"```JSON\n{\"angles\":[\"角度一\",\"角度二\",\"角度三\"]}\n```",
		`{"angles":[{"angle":"角度一"},{"text":"角度二"},{"angle":"角度三"}]}`,
	} {
		result, err := parseAngleSuggestions(text)
		if err != nil || len(result) != 3 || result[0] != "角度一" {
			t.Fatalf("valid shape rejected: %v", err)
		}
	}
	for _, text := range []string{`{"angles":["一","二"]}`, `{"angles":["一","一","三"]}`, `{"angles":["一"," ","三"]}`, `{"angles":[{"title":"标题"},"二","三"]}`, `{"angles":[{"angle":"一","text":"不同内容"},"二","三"]}`, `{"angles":[null,2,"三"]}`, `{"title":"完整文案","body":"并非角度建议"}`, "模型没有返回 JSON"} {
		if _, err := parseAngleSuggestions(text); err == nil {
			t.Fatal("accepted invalid suggestion", text)
		}
	}
}

func TestEmptyAngleRequestDoesNotCreateJob(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "空白项目"}, 201))
	p.Sources = []domain.Source{{ID: "empty", Label: "原文", Text: "  "}}
	store.Put(a.Store.DB, "projects", p.ID, p)
	for _, input := range []map[string]any{{}, {"copy_text": "  ", "source_ids": []string{"empty"}}, {"audience": "大学生"}} {
		request(t, a, "POST", "/rewrites/"+p.ID+"/suggest-angles", input, 400)
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 0 {
		t.Fatal("empty request created a model task")
	}
	m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "测试模型", "model": "test", "base_url": "https://example.com/v1", "secret": "test"}, 200))
	p.Sources[0].Text = "已有参考笔记的文字"
	store.Put(a.Store.DB, "projects", p.ID, p)
	request(t, a, "POST", "/rewrites/"+p.ID+"/suggest-angles", map[string]any{"model_id": m.ID, "source_ids": []string{"empty"}}, 202)
}

func TestAngleTopicOrCopyOrBoth(t *testing.T) {
	for _, tc := range []struct{ name, topic, copy string }{
		{"topic", "租房桌面整理", ""},
		{"copy", "", "我买了收纳盒，桌面反而更乱了。"},
		{"both", "租房桌面整理", "我买了收纳盒，桌面反而更乱了。"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := testApp(t)
			m := decode[rewriteModel](t, request(t, a, "POST", "/rewrite-models", map[string]string{"name": "测试", "model": "fixture", "base_url": "https://example.com/v1", "secret": "test"}, 200))
			p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "角度测试"}, 201))
			input := map[string]any{"model_id": m.ID, "copy_text": tc.copy, "creative": domain.CreativeSettings{Topic: tc.topic}}
			queued := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/suggest-angles", input, 202))
			j, err := store.Get[domain.Job](a.Store.DB, "jobs", queued["job_id"])
			if err != nil {
				t.Fatal(err)
			}
			if tc.topic != "" && !strings.Contains(asString(j.Payload["instructions"]), tc.topic) {
				t.Fatal("topic not sent to model")
			}
			if tc.copy != "" && !strings.Contains(asString(j.Payload["source"]), "【用户当前文案（含尚未保存的编辑）】\n"+tc.copy) {
				t.Fatal("current copy not sent to model")
			}
			if tc.copy == "" && strings.TrimSpace(asString(j.Payload["source"])) != "" {
				t.Fatal("fabricated copy for topic-only input")
			}
		})
	}
}

func TestAngleNaturalParagraphsPreserveContent(t *testing.T) {
	text := "1. 买了收纳盒，桌子为什么反而更乱？\n可以从总要翻找的小物件聊起。\n\n2. " + strings.Repeat("细节", 120) + "\n\n3. 哪样东西你每天都要找？"
	values, err := parseAngleSuggestions(text)
	if err != nil || len(values) != 3 || !strings.Contains(values[0], "总要翻找") || len([]rune(values[1])) != 240 {
		t.Fatal("natural suggestions were rejected or truncated", err)
	}
}
