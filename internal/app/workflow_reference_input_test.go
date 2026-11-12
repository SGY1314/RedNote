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

func TestSelectedReferenceFrozenAndUncheckedTextExcluded(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID
	selection := workflowReferenceInput{PolicyVersion: 1, Title: "不应发送的手写标题", Body: "只发送选中的参考文案", Topics: []string{"选中话题"}, UseBody: true}
	request(t, a, "POST", base+"/workflow/drafts/title", map[string]any{"revision": 0, "data": map[string]any{"reference_input": selection}}, 200)
	created := decode[map[string]string](t, request(t, a, "POST", base+"/titles/generate", map[string]any{"model_id": "initial", "count": 1}, 202))
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
	selection.Body = "之后修改不能覆盖任务"
	request(t, a, "POST", base+"/workflow/drafts/title", map[string]any{"revision": 1, "data": map[string]any{"reference_input": selection}}, 200)
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(req.Body)
		text := string(body)
		if !strings.Contains(text, "只发送选中的参考文案") || !strings.Contains(text, "选中话题") {
			t.Fatal("selected content missing")
		}
		for _, s := range []string{"不应发送的手写标题", "之后修改不能覆盖任务", "唯一参考标题", "不能出现在标题请求中的原文标记"} {
			if strings.Contains(text, s) {
				t.Fatalf("unchecked or stale content leaked: %s", s)
			}
		}
		return planReply(`{"titles":["选中内容生成的标题"]}`), nil
	})
	if _, err := a.runTitleRewrite(job); err != nil {
		t.Fatal(err)
	}
}
func TestDefaultProfileAndReferenceValidation(t *testing.T) {
	a, p := stagedFixture(t)
	fields := workflowAccountFields{Name: "默认作者", Positioning: "分享日常"}
	request(t, a, "PUT", "/profile/default", fields, 200)
	got := decode[workflowAccountFields](t, request(t, a, "GET", "/profile/default", nil, 200))
	if got != fields {
		t.Fatal("defaults not persisted")
	}
	request(t, a, "PUT", "/profile/default", map[string]string{"style": strings.Repeat("长", 601)}, 400)
	r := &workflowReferenceInput{UseImages: false, AssetIDs: []string{"missing"}}
	if refs, err := a.referenceInputImages(p, r); err != nil || len(refs) != 0 {
		t.Fatal("unchecked images must not be read")
	}
	r.UseImages = true
	if _, err := a.referenceInputImages(p, r); err == nil {
		t.Fatal("missing image accepted")
	}
	w, _ := a.readWorkflow(p.ID)
	raw, _ := json.Marshal(map[string]any{"reference_input": r})
	w.Drafts["image"] = workflowDraft{Data: raw}
	if referenceInputFor(w, "image") == nil {
		t.Fatal("selection not retained")
	}
}

func TestStageConfirmationUpdatesOnlyOtherReferences(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	base := "/rewrites/" + p.ID
	for _, scope := range []string{"title", "copy", "image", "video-script"} {
		selection := workflowReferenceInput{PolicyVersion: 1, Title: "旧参考标题", Body: "旧参考正文", Topics: []string{"旧话题"}, UseTitle: false, UseBody: true, UseImages: false, AssetIDs: []string{source.AssetIDs[0]}}
		request(t, a, "POST", base+"/workflow/drafts/"+scope, map[string]any{"revision": 0, "data": map[string]any{"reference_input": selection, "requirements": "保留补充要求", "model_id": "initial"}}, 200)
	}
	title := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "title", "text": "新确认的参考标题"}, 201))
	for _, scope := range []string{"title", "copy", "image", "video-script"} {
		r := referenceInputFor(title.Workflow, scope)
		expectedTitle := "新确认的参考标题"
		if scope == "title" {
			expectedTitle = "旧参考标题"
		}
		if r.Title != expectedTitle || r.Body != "旧参考正文" || r.UseTitle || !r.UseBody || r.UseImages || len(r.AssetIDs) != 1 {
			t.Fatalf("title reference not synchronized or switches changed: %s %#v", scope, r)
		}
	}
	copyResult := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "copy", "text": "新确认的参考文案", "topics": []string{"新话题"}, "title_key": title.Workflow.Title.Key}, 201))
	saved, _ := a.readWorkflow(p.ID)
	for _, scope := range []string{"title", "copy", "image", "video-script"} {
		r := referenceInputFor(saved, scope)
		expectedTitle, expectedBody, expectedTopic := "新确认的参考标题", "新确认的参考文案", "新话题"
		expectedRevision := 3
		if scope == "title" {
			expectedTitle = "旧参考标题"
			expectedRevision = 2
		}
		if scope == "copy" {
			expectedBody = "旧参考正文"
			expectedTopic = "旧话题"
			expectedRevision = 2
		}
		if r.Title != expectedTitle || r.Body != expectedBody || len(r.Topics) != 1 || r.Topics[0] != expectedTopic || r.UseTitle || r.UseImages {
			t.Fatal("copy references not persisted", scope, r)
		}
		var fields map[string]any
		_ = json.Unmarshal(saved.Drafts[scope].Data, &fields)
		if fields["requirements"] != "保留补充要求" || saved.Drafts[scope].Revision != expectedRevision {
			t.Fatal("draft data or revision lost")
		}
	}
	before, _ := store.Get[domain.Revision](a.Store.DB, "revisions", source.ID)
	if before.Title != source.Title || before.Body != source.Body {
		t.Fatal("source was modified")
	}
	old, _ := store.Get[domain.Version](a.Store.DB, "versions", title.Version.ID)
	if old.Body != source.Body {
		t.Fatal("saved title version was modified")
	}
	_ = copyResult
	// The next generation must use the newly confirmed text.
	created := decode[map[string]string](t, request(t, a, "POST", base+"/titles/generate", map[string]any{"model_id": "initial", "count": 1}, 202))
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
	reference := asString(job.Payload["reference"])
	if !strings.Contains(reference, "新确认的参考文案") || strings.Contains(reference, "新确认的参考标题") {
		t.Fatal("next request ignored reference switches", reference)
	}
}

// Missing per-stage drafts must fall back to confirmed content, not the source.
func TestMissingReferenceUsesConfirmedOtherField(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	base := "/rewrites/" + p.ID
	title := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "title", "text": "已确认标题"}, 201))
	w := title.Workflow
	delete(w.Drafts, "image")
	if err := a.syncConfirmedReferences(&w, source, "copy", domain.Content{Body: "已确认正文", Topics: []string{"新话题"}}); err != nil {
		t.Fatal(err)
	}
	r := referenceInputFor(w, "image")
	if r.Title != "已确认标题" || r.Body != "已确认正文" {
		t.Fatalf("confirmed title lost: %#v", r)
	}
	copyResult := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "copy", "text": "已确认正文", "topics": []string{"新话题"}, "title_key": title.Workflow.Title.Key}, 201))
	w = copyResult.Workflow
	delete(w.Drafts, "video-script")
	if err := a.syncConfirmedReferences(&w, source, "title", domain.Content{Title: "再次确认标题"}); err != nil {
		t.Fatal(err)
	}
	r = referenceInputFor(w, "video-script")
	if r.Title != "再次确认标题" || r.Body != "已确认正文" || len(r.Topics) != 1 || r.Topics[0] != "新话题" {
		t.Fatalf("confirmed copy lost: %#v", r)
	}
}

func TestManualReferencesSurviveOtherStageConfirmation(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	base := "/rewrites/" + p.ID
	title := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "title", "text": "已确认标题"}, 201))
	d := title.Workflow.Drafts["image"]
	selection := referenceInputFor(title.Workflow, "image")
	selection.Title, selection.Body = "手动参考标题", "手动参考正文"
	request(t, a, "POST", base+"/workflow/drafts/image", map[string]any{"revision": d.Revision, "data": map[string]any{"reference_input": selection}}, 200)
	copyResult := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "copy", "text": "新确认正文", "title_key": title.Workflow.Title.Key}, 201))
	r := referenceInputFor(copyResult.Workflow, "image")
	if r.Title != "手动参考标题" || r.Body != "新确认正文" {
		t.Fatalf("unrelated manual title overwritten: %#v", r)
	}
	d = copyResult.Workflow.Drafts["image"]
	r.Body = "再次手动修改正文"
	request(t, a, "POST", base+"/workflow/drafts/image", map[string]any{"revision": d.Revision, "data": map[string]any{"reference_input": r}}, 200)
	request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "title", "text": "再次确认标题", "title_key": copyResult.Workflow.Title.Key}, 201)
	saved, _ := a.readWorkflow(p.ID)
	r = referenceInputFor(saved, "image")
	if r.Body != "再次手动修改正文" || r.Title != "再次确认标题" {
		t.Fatalf("unrelated manual copy overwritten: %#v", r)
	}
}

func TestTextReferencePolicyMigration(t *testing.T) {
	for _, manual := range []bool{false, true} {
		w := creationWorkflow{Title: workflowTitle{Key: "confirmed-title", Text: "确认标题"}, Copy: workflowCopy{Key: "confirmed-copy", Body: "确认正文", Topics: []string{"确认话题"}}, Drafts: map[string]workflowDraft{}}
		for _, scope := range []string{"title", "copy"} {
			r := workflowReferenceInput{Title: w.Title.Text, Body: w.Copy.Body, Topics: w.Copy.Topics, UseTitle: true, UseBody: false, AssetIDs: []string{"image"}}
			if manual {
				r.Title, r.Body = "手动标题", "手动正文"
			}
			raw, _ := json.Marshal(map[string]any{"reference_input": r, "requirements": "保留要求"})
			w.Drafts[scope] = workflowDraft{Revision: 5, Data: raw}
		}
		rev := domain.Revision{Title: "原标题", Body: "原正文", Topics: []string{"原话题"}}
		if err := migrateTextReferences(&w, rev); err != nil {
			t.Fatal(err)
		}
		title, copy := referenceInputFor(w, "title"), referenceInputFor(w, "copy")
		if manual {
			if title.Title != "手动标题" || copy.Body != "手动正文" {
				t.Fatal("manual edits lost")
			}
		} else if title.Title != rev.Title || title.Body != w.Copy.Body || copy.Title != w.Title.Text || copy.Body != rev.Body || copy.Topics[0] != rev.Topics[0] {
			t.Fatal("incorrect migrated defaults")
		}
		if !title.UseTitle || title.UseBody || len(title.AssetIDs) != 1 {
			t.Fatal("selection changed")
		}
		// Future manual edits equal to confirmed text must also survive a reload.
		title.Title = w.Title.Text
		raw, _ := json.Marshal(map[string]any{"reference_input": title})
		d := w.Drafts["title"]
		d.Data = raw
		w.Drafts["title"] = d
		if err := migrateTextReferences(&w, rev); err != nil {
			t.Fatal(err)
		}
		if referenceInputFor(w, "title").Title != w.Title.Text || w.Drafts["title"].Revision != 6 {
			t.Fatal("migration repeated")
		}
	}
}

func TestMissingTextReferenceGenerationUsesCrossConfirmedContent(t *testing.T) {
	for _, scope := range []string{"title", "copy"} {
		a, p := stagedFixture(t)
		base := "/rewrites/" + p.ID
		title := decode[stageReply](t, request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "title", "text": "已确认交叉标题"}, 201))
		request(t, a, "POST", base+"/workflow/stage", map[string]any{"step": "copy", "text": "已确认交叉正文", "topics": []string{"新话题"}, "title_key": title.Workflow.Title.Key}, 201)
		w, _ := a.readWorkflow(p.ID)
		delete(w.Drafts, scope)
		if err := store.Put(a.Store.DB, "creation_workflows", p.ID, w); err != nil {
			t.Fatal(err)
		}
		endpoint := "/titles/generate"
		if scope == "copy" {
			endpoint = "/copies/generate"
		}
		created := decode[map[string]string](t, request(t, a, "POST", base+endpoint, map[string]any{"model_id": "initial", "count": 1}, 202))
		job, _ := store.Get[domain.Job](a.Store.DB, "jobs", created["job_id"])
		ref := asString(job.Payload["reference"])
		if scope == "title" && (!strings.Contains(ref, "已确认交叉正文") || strings.Contains(ref, "已确认交叉标题")) {
			t.Fatal("wrong title input", ref)
		}
		if scope == "copy" && (!strings.Contains(ref, "已确认交叉标题") || strings.Contains(ref, "已确认交叉正文")) {
			t.Fatal("wrong copy input", ref)
		}
		if asString(job.Payload["title"]) != "" {
			t.Fatal("hidden title input leaked")
		}
	}
}
