package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func stagedFixture(t *testing.T) (*App, domain.Project) {
	t.Helper()
	a := testApp(t)
	noteID, _ := collectMediaFixture(t, a, "xhs", "staged")
	note, _ := store.Get[domain.Note](a.Store.DB, "notes", noteID)
	rev, _ := store.Get[domain.Revision](a.Store.DB, "revisions", note.RevisionID)
	rev.Title = "唯一参考标题"
	rev.Body = "不能出现在标题请求中的原文标记"
	rev.Topics = []string{"原始话题"}
	store.Put(a.Store.DB, "revisions", rev.ID, rev)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]any{"note_id": noteID}, 201))
	request(t, a, "GET", "/rewrites/"+p.ID+"/workflow", nil, 200)
	sealed, err := adapter.Seal("staged-key")
	if err != nil {
		t.Fatal(err)
	}
	store.Put(a.Store.DB, "settings", "rewrite-models", []rewriteModel{{ID: "initial", Name: "迁移模型", Service: domain.Service{BaseURL: "https://example.com/v1", Model: "original-model", Secret: sealed}}})
	if err = a.initializeStageModels(); err != nil {
		t.Fatal(err)
	}
	return a, p
}
func TestStagedModelsAreIndependentAndTextCallsAreFrozen(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID
	result := decode[map[string]string](t, request(t, a, "POST", base+"/titles/generate", map[string]any{"model_id": "initial", "prompt": "简洁", "requirements": "3个", "angle": "经验分享"}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	if !strings.Contains(jsonString(j), "不能出现在") || strings.Contains(jsonString(j), "staged-key") {
		t.Fatal("title lost the source body or exposed a secret")
	}
	if _, err := a.saveModelFor("title", modelSaveRequest{rewriteModel: rewriteModel{Name: "新标题配置", Service: domain.Service{BaseURL: "https://changed.example/v1", Model: "changed", Secret: "changed-key"}}}, "initial"); err != nil {
		t.Fatal(err)
	}
	copies, _ := a.modelsFor("copy")
	plans, _ := a.modelsFor("image-plan")
	if copies[0].Model != "original-model" || plans[0].Model != "original-model" {
		t.Fatal("independent model overwritten")
	}
	oldTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		var input map[string]any
		json.NewDecoder(req.Body).Decode(&input)
		if req.URL.Host != "example.com" || input["model"] != "original-model" {
			t.Fatal("frozen service changed")
		}
		if !strings.Contains(jsonString(input), "经验分享") {
			t.Fatal("angle missing from title request")
		}
		if !strings.Contains(jsonString(input), "不能出现在") || !strings.Contains(jsonString(input), "原始话题") {
			t.Fatal("title prompt lost the original copy or topics")
		}
		return planReply(`{"titles":["候选标题一","候选标题二","候选标题三"]}`), nil
	})
	if _, err := a.runTitleRewrite(j); err != nil {
		t.Fatal(err)
	}
	record, _ := store.Get[textGeneration](a.Store.DB, "title_generations", j.ID)
	if len(record.Titles) != 3 {
		t.Fatal("missing candidates")
	}
	request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": record.Titles[0], "generation_id": record.ID, "angle": "经验分享"}, 200)
	request(t, a, "POST", base+"/generate", map[string]any{}, 409)
	result = decode[map[string]string](t, request(t, a, "POST", base+"/copies/generate", map[string]any{"model_id": "initial"}, 202))
	j, _ = store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		var input map[string]any
		json.NewDecoder(req.Body).Decode(&input)
		s := jsonString(input)
		if !strings.Contains(s, "经验分享") {
			t.Fatal("confirmed angle missing from copy request")
		}
		if !strings.Contains(s, "不能出现在") || !strings.Contains(s, "候选标题一") {
			t.Fatal("copy missing original body or confirmed title")
		}
		return planReply(`{"copies":[{"body":"第一份完整正文","topics":["生活"]},{"body":"第二份完整正文","topics":[]},{"body":"第三份完整正文","topics":[]}]}`), nil
	})
	if _, err := a.runCopyRewrite(j); err != nil {
		t.Fatal(err)
	}
	record, _ = store.Get[textGeneration](a.Store.DB, "copy_generations", j.ID)
	if len(record.Copies) != 3 || record.Copies[0].Title != "候选标题一" {
		t.Fatal("copy record mixed with title")
	}
	// Removing a catalog is explicit. It must never silently fall back.
	store.Put(a.Store.DB, "settings", "copy-models", []rewriteModel{})
	a.initializeStageModels()
	models, _ := a.modelsFor("copy")
	if len(models) != 0 {
		t.Fatal("empty catalog inherited models")
	}
}

func TestStagedDraftConflictAndUpstreamInvalidationPreservePublication(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID
	request(t, a, "POST", base+"/workflow/drafts/title", map[string]any{"revision": 0, "data": map[string]any{"text": "草稿标题"}}, 200)
	request(t, a, "POST", base+"/workflow/drafts/title", map[string]any{"revision": 0, "data": map[string]any{"text": "过期草稿"}}, 409)
	w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "确认标题"}, 200))
	request(t, a, "POST", base+"/copies/confirm", map[string]any{"body": "正文", "title_key": "wrong"}, 409)
	w = decode[creationWorkflow](t, request(t, a, "POST", base+"/copies/confirm", map[string]any{"body": "确认正文", "topics": []string{"话题"}, "title_key": w.Title.Key}, 200))
	plan := decode[workflowImagePlan](t, request(t, a, "POST", base+"/image-plans/confirm", map[string]any{"copy_key": w.Copy.Key, "scenes": []string{"完整画面描述"}, "reference_asset_ids": []string{}}, 201))
	if err := a.workflowRequiresImagePlan(p.ID, plan.ID, []string{"完整画面描述"}); err != nil {
		t.Fatal(err)
	}
	if err := a.workflowRequiresImagePlan(p.ID, plan.ID, []string{"未确认修改"}); err == nil {
		t.Fatal("unconfirmed image passed")
	}
	image := sampleImage(t, a)
	release := map[string]any{"copy_key": w.Copy.Key, "media_reviewed": true, "media": domain.VersionMedia{Kind: "image", AssetIDs: []string{image.ID}}}
	v := decode[domain.Version](t, request(t, a, "POST", base+"/workflow/release", release, 201))
	again := decode[domain.Version](t, request(t, a, "POST", base+"/workflow/release", release, 200))
	if again.ID != v.ID {
		t.Fatal("duplicate release created")
	}
	if v.Status != "confirmed" || v.WorkflowSnapshot["image_plan_id"] != plan.ID {
		t.Fatal("release lineage missing")
	}
	request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "新确认标题"}, 200)
	if err := a.workflowRequiresCopy(p.ID); err != nil {
		t.Fatal("title edit locked the independent copy module", err)
	}
	request(t, a, "POST", base+"/workflow/release", release, 409)
	w, _ = a.readWorkflow(p.ID)
	w = decode[creationWorkflow](t, request(t, a, "POST", base+"/copies/confirm", map[string]any{"body": "新正文", "title_key": w.Title.Key}, 200))
	if err := a.workflowRequiresImagePlan(p.ID, plan.ID, []string{"完整画面描述"}); err == nil {
		t.Fatal("stale plan usable")
	}
	old, _ := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	if old.Title != "确认标题" || old.Body != "确认正文" {
		t.Fatal("old publication changed")
	}
	stored, _ := a.readWorkflow(p.ID)
	var draft map[string]any
	json.Unmarshal(stored.Drafts["title"].Data, &draft)
	if draft["text"] != "草稿标题" {
		t.Fatal("stale tab overwrote draft")
	}
	request(t, a, "POST", base+"/workflow/source", map[string]any{"note_id": p.NoteID}, 409)
}

func TestStagedReferenceAndVideoScriptSeparation(t *testing.T) {
	a, p := stagedFixture(t)
	other := sampleImage(t, a)
	other.Source = "collection"
	other.RevisionID = "other-post"
	store.Put(a.Store.DB, "assets", other.ID, other)
	if err := a.validateWorkflowReferences(p, []string{other.ID}); err == nil {
		t.Fatal("another post allowed")
	}
	other.Source = "upload"
	store.Put(a.Store.DB, "assets", other.ID, other)
	if err := a.validateWorkflowReferences(p, []string{other.ID}); err != nil {
		t.Fatal(err)
	}
	b := videoBrief{CopyKey: "confirmed-copy", Duration: 15, CopyText: "已确认文案"}
	output := `{"title":"脚本标题","concept":"完整故事结构","style":"统一风格","shots":[{"duration":5,"visual":"开场画面","camera":"特写","narration":"开场"},{"duration":5,"visual":"中段画面","camera":"推近","narration":"中段"},{"duration":5,"visual":"收尾画面","camera":"拉远","narration":"收尾"}],"subtitle_plan":"按口播逐句显示","music":"轻音乐，转场音效"}`
	s, err := parseVideoPlan(output, b)
	if err != nil || s.Music == "" || s.SubtitlePlan == "" {
		t.Fatal("incomplete full script", err)
	}
	s.Music = ""
	if validateVideoScript(s) == nil {
		t.Fatal("new script missing soundtrack accepted")
	}
}

func TestStagedAngleChangeUpdatesBasisAndPreservesCopy(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID
	w := decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "原标题", "angle": "经验分享"}, 200))
	w = decode[creationWorkflow](t, request(t, a, "POST", base+"/copies/confirm", map[string]any{"body": "已确认正文", "title_key": w.Title.Key}, 200))
	old := w.Title.Key
	if !strings.Contains(a.workflowCopyText(p.ID), "经验分享") {
		t.Fatal("downstream angle missing")
	}
	w = decode[creationWorkflow](t, request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "原标题", "angle": "清单推荐"}, 200))
	if w.Title.Key == old || w.Copy.Body != "已确认正文" || a.workflowRequiresCopy(p.ID) != nil {
		t.Fatal("angle change locked or discarded the independent copy module")
	}
	if a.workflowCopyKey(p.ID) == w.Copy.Key || !strings.Contains(a.workflowCopyText(p.ID), "清单推荐") {
		t.Fatal("basis did not invalidate old media planning inputs")
	}
	request(t, a, "POST", base+"/titles/confirm", map[string]any{"text": "原标题", "angle": strings.Repeat("字", 501)}, 400)
}
