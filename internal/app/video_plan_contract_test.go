package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

const validSixSecondPlan = `{"title":"咖啡片刻","concept":"端起白杯然后品尝","style":"同一人物白杯暖光","shots":[{"duration":6,"visual":"0-2秒端起白杯；2-6秒连续品尝","camera":"近景平稳跟随","narration":"慢下来，喝杯咖啡"}]}`

func TestVideoPlanReportsExactContractFailure(t *testing.T) {
	b := videoBrief{Mode: "continuous", Duration: 6, CopyText: "喝咖啡"}
	for _, tc := range []struct{ raw, want string }{
		{`{"title":"标题","body":"普通文案","topics":[]}`, "concept"},
		{strings.Replace(validSixSecondPlan, `"duration":6`, `"duration":10`, 1), "应为 6 秒，实际返回 10 秒"},
		{strings.Replace(validSixSecondPlan, `"camera":"近景平稳跟随"`, `"camera":""`, 1), "camera"},
		{strings.Replace(validSixSecondPlan, `"shots":[`, `"shots":[],"other":[`, 1), "实际返回 0 条"},
		{`{"script":` + validSixSecondPlan + `}`, "title"},
	} {
		_, e := parseVideoPlan(tc.raw, b)
		if e == nil || !strings.Contains(e.Error(), tc.want) {
			t.Fatalf("wanted %s, got %v", tc.want, e)
		}
	}
	if _, e := parseVideoPlan(`{"error":"reference_unavailable"}`, b); !errors.Is(e, errVideoReferenceUnavailable) {
		t.Fatal(e)
	}
	s, e := parseVideoPlan("```json\n"+validSixSecondPlan+"\n```", b)
	if e != nil || s.Shots[0].Duration != 6 {
		t.Fatal("valid short script rejected", e)
	}
}

func TestVideoPlanSixSecondRepairIsBoundedAndNeverGeneratesVideo(t *testing.T) {
	a := testApp(t)
	p, m := planFixture(t, a, true)
	img := sampleImage(t, a)
	b := videoBrief{ModelID: m.ID, Mode: "continuous", Duration: 6, CopyText: "把长文案提炼成咖啡片刻", ReferenceIDs: []string{img.ID}}
	b.Creative = &domain.CreativeSettings{Angle: "忙里偷闲", VideoHook: "action"}
	r := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/video/plan", b, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", r["job_id"])
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	calls := 0
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Path != "/v1/chat/completions" {
			t.Fatal("unexpected video call")
		}
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
		}
		json.NewDecoder(req.Body).Decode(&body)
		system := body.Messages[0].Content.(string)
		if !strings.Contains(system, `"duration":6`) || strings.Contains(system, `"duration":10`) || !strings.Contains(system, "shots 只能有 1 个元素") {
			t.Fatal("wrong duration/shape in system schema")
		}
		encoded, _ := json.Marshal(body.Messages[1].Content)
		if !strings.Contains(string(encoded), "data:image/") {
			t.Fatal("reference lost during repair")
		}
		for _, want := range []string{"忙里偷闲", "动作开场", "结尾回应开头"} {
			if !strings.Contains(string(encoded), want) {
				t.Fatal("creative brief lost during planning or repair", want)
			}
		}
		if calls == 1 {
			return planReply(`{"title":"普通文案","body":"不是完整脚本"}`), nil
		}
		if len(body.Messages) != 4 || !strings.Contains(body.Messages[3].Content.(string), "concept") {
			t.Fatal("repair did not identify missing fields")
		}
		return planReply(validSixSecondPlan), nil
	})
	id, e := a.runVideoPlan(j)
	if e != nil || calls != 2 {
		t.Fatalf("repair failed: %v calls=%d", e, calls)
	}
	s, _ := store.Get[videoScript](a.Store.DB, "video_scripts", id)
	if s.Brief.Creative == nil || s.Brief.Creative.Angle != "忙里偷闲" || s.Brief.Creative.VideoHook != "action" {
		t.Fatal("script lost creative snapshot")
	}
	if s.ConfirmedAt != "" || len(s.Shots) != 1 || s.Shots[0].Duration != 6 {
		t.Fatal("invalid repaired snapshot")
	}
	if _, e = a.runVideoPlan(j); e != nil || calls != 2 {
		t.Fatal("completed planning called again")
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, job := range jobs {
		if job.Kind == "video_generate" {
			t.Fatal("auto generated paid video")
		}
	}
}

func TestVideoPlanRepairStopsOnProviderErrorsAndPersistentBadOutput(t *testing.T) {
	a := testApp(t)
	_, m := planFixture(t, a, false)
	models, _ := a.rewriteModels()
	var svc domain.Service
	for _, v := range models {
		if v.ID == m.ID {
			svc = v.Service
		}
	}
	orig := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = orig })
	b := videoBrief{Mode: "continuous", Duration: 6, CopyText: "咖啡"}
	for _, tc := range []struct {
		status, calls int
		raw, want     string
	}{
		{200, 2, `{"title":"只有标题"}`, "concept"},
		{200, 1, `{"error":"reference_unavailable"}`, "无法理解参考画面"},
		{403, 1, `{"error":{"message":"private-provider-detail"}}`, "403"},
	} {
		calls := 0
		http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
			calls++
			if tc.status == 200 {
				return planReply(tc.raw), nil
			}
			return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.raw))}, nil
		})
		_, e := a.requestVideoPlan(svc, b, "请规划咖啡片刻")
		if e == nil || calls != tc.calls || !strings.Contains(e.Error(), tc.want) || strings.Contains(e.Error(), "private-provider-detail") {
			t.Fatalf("unexpected retries/error: calls=%d err=%v", calls, e)
		}
	}
}
