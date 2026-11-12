package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestCopyCountsUseFrozenSavedTitleSourceAndAccount(t *testing.T) {
	for count := 1; count <= 5; count++ {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			a, p := stagedFixture(t)
			setTestWorkflowPrompt(t, a, "copy", "文案管理员冻结策略")
			base := "/rewrites/" + p.ID
			confirmTestAccount(t, a, p.ID)
			w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "已经保存的标题"}, 200))
			created := decode[map[string]string](t, request(t, a, "POST", base+"/copies/generate", map[string]any{"model_id": "initial", "count": count, "requirements": "具体、自然、适合新手", "title": "客户端伪造标题", "reference": "客户端伪造正文"}, 202))
			setTestWorkflowPrompt(t, a, "copy", "文案后来修改的策略")
			job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
			request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "任务之后的新标题"}, 200)
			request(t, a, "POST", base+"/workflow/account", map[string]any{"revision": 1, "skip": true}, 200)
			previous := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = previous })
			calls := 0
			http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				body, _ := io.ReadAll(req.Body)
				for _, value := range []string{"文案管理员冻结策略", "已经保存的标题", "不能出现在标题请求中的原文标记", "原始话题", "独立咖啡师", "具体、自然、适合新手", fmt.Sprintf("恰好包含%d项", count)} {
					if !strings.Contains(string(body), value) {
						t.Fatalf("copy model request lost %q", value)
					}
				}
				for _, value := range []string{"文案后来修改的策略", "任务之后的新标题", "客户端伪造标题", "客户端伪造正文"} {
					if strings.Contains(string(body), value) {
						t.Fatalf("frozen generation input was replaced by %q", value)
					}
				}
				copies := []domain.Content{}
				for index := 1; index <= count; index++ {
					copies = append(copies, domain.Content{Body: fmt.Sprintf("第%d份完整文案，先磨豆，再缓慢注水，最后品尝。", index), Topics: []string{"咖啡", "手冲"}})
				}
				result, _ := json.Marshal(map[string]any{"copies": copies})
				return planReply(string(result)), nil
			})
			if _, err := a.runCopyRewrite(job); err != nil {
				t.Fatal(err)
			}
			record, _ := store.Get[textGeneration](a.Store.DB, "copy_generations", job.ID)
			if calls != 1 || record.Count != count || len(record.Copies) != count || record.TitleKey != w.Title.Key {
				t.Fatal("copy count or frozen title basis was lost", record)
			}
		})
	}
	a, p := stagedFixture(t)
	for _, count := range []int{-1, 6, 10} {
		request(t, a, "POST", "/rewrites/"+p.ID+"/copies/generate", map[string]any{"model_id": "initial", "count": count}, 400)
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, job := range jobs {
		if job.Kind == "copy_rewrite" {
			t.Fatal("an invalid count created a model task")
		}
	}
}
