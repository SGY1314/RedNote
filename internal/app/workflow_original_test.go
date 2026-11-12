package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestOriginalCreationInputsSnapshotsAndManualTitle(t *testing.T) {
	a, linked := stagedFixture(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]any{"name": "原创咖啡笔记"}, 201))
	base := "/rewrites/" + p.ID
	request(t, a, "GET", base+"/workflow", nil, 200)
	p, _ = store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	if p.NoteID != "" || p.RevisionID == "" {
		t.Fatal("original creation incorrectly requires a note")
	}
	basis, _ := a.storedWorkflowBasis(p.ID)
	manual := decode[struct {
		Version domain.Version `json:"version"`
	}](t, request(t, a, "POST", base+"/workflow/stage", workflowStageRequest{Step: "title", Text: "手写原创标题", TitleKey: basis.Title.Key}, 201))
	if manual.Version.Title != "手写原创标题" || manual.Version.Status != "draft" {
		t.Fatal("manual title must be saved without an AI generation or source note")
	}
	asset := domain.Asset{ID: "original-upload", Name: "自己的咖啡图片", Kind: "image", Source: "upload", Status: "ready", Path: "original-upload.png", CreatedAt: Now()}
	if err := os.WriteFile(filepath.Join(a.Config.DataDir, "media", asset.Path), seriesPNG(t, 70), 0600); err != nil {
		t.Fatal(err)
	}
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	input := workflowOriginalInput{Title: "周末手冲", Body: "今天在家磨豆、注水，记录一杯手冲咖啡。", Topics: []string{"咖啡"}, AssetIDs: []string{asset.ID}}
	save := func(revision int, value workflowOriginalInput, status int) map[string]json.RawMessage {
		return decode[map[string]json.RawMessage](t, request(t, a, "POST", base+"/workflow/drafts/source", map[string]any{"revision": revision, "data": value}, status))
	}
	save(0, input, 200)
	first, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	save(1, input, 200)
	same, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	if first.RevisionID != same.RevisionID || same.NoteID != "" {
		t.Fatal("unchanged input must retain its snapshot without linking a note")
	}
	save(0, input, 409)
	input.Body = "更新后的原创正文"
	save(2, input, 200)
	changed, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	old, _ := store.Get[domain.Revision](a.Store.DB, "revisions", first.RevisionID)
	if changed.RevisionID == first.RevisionID || old.Body == input.Body {
		t.Fatal("original input snapshots are not immutable")
	}
	unchangedAsset, _ := store.Get[domain.Asset](a.Store.DB, "assets", asset.ID)
	if unchangedAsset.RevisionID != "" || unchangedAsset.ProjectID != "" {
		t.Fatal("shared library asset was reassigned")
	}
	source, mediaErr := a.workflowMediaContext(changed, "image", "fixture", []string{asset.ID}, "柔和光线", "2k", "3:4", 1)
	if mediaErr != nil {
		t.Fatal(mediaErr)
	}
	if source.RevisionID != changed.RevisionID || !slices.Equal(source.SourceIDs, []string{asset.ID}) {
		t.Fatal("original project does not accept its selected library image")
	}
	basis, _ = a.storedWorkflowBasis(p.ID)
	reply := decode[struct {
		Version      domain.Version       `json:"version"`
		Publications []domain.Publication `json:"publications"`
	}](t, request(t, a, "POST", base+"/workflow/stage", workflowStageRequest{Step: "title", Text: "手写原创标题", TitleKey: basis.Title.Key, Publish: true}, 201))
	if len(reply.Publications) != 1 || reply.Publications[0].Body != input.Body || !slices.Equal(reply.Version.Media.AssetIDs, []string{asset.ID}) {
		t.Fatal("original publication lost its content or selected material")
	}
	store.Put(a.Store.DB, "assets", "other-upload", domain.Asset{ID: "other-upload", Source: "upload", Kind: "image", Status: "ready", Path: asset.Path})
	if _, err := a.workflowMediaContext(changed, "image", "fixture", []string{"other-upload"}, "", "2k", "3:4", 1); err == nil {
		t.Fatal("unselected material accepted")
	}
	input.AssetIDs = []string{"missing"}
	save(3, input, 400)
	asset.LibraryState = "collected"
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	input.AssetIDs = []string{asset.ID}
	save(3, input, 400)
	request(t, a, "POST", "/rewrites/"+linked.ID+"/workflow/drafts/source", map[string]any{"revision": 0, "data": input}, 400)
	storedPub := confirmPreparedTest(t, a, reply.Publications[0])
	if storedPub.Body != reply.Publications[0].Body {
		t.Fatal("publication snapshot changed")
	}
}

func TestOriginalCreationGeneratesWithoutCollectedNote(t *testing.T) {
	a, _ := stagedFixture(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]any{"name": "原创"}, 201))
	base := "/rewrites/" + p.ID
	request(t, a, "POST", base+"/titles/generate", map[string]any{"model_id": "initial", "count": 1}, 400)
	jobID := decode[map[string]string](t, request(t, a, "POST", base+"/titles/generate", map[string]any{"model_id": "initial", "count": 1, "requirements": "在家做手冲咖啡，语气自然"}, 202))["job_id"]
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", jobID)
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	http.DefaultTransport = rewriteTransport(func(req *http.Request) (*http.Response, error) {
		var body map[string]any
		json.NewDecoder(req.Body).Decode(&body)
		encoded, _ := json.Marshal(body)
		if !strings.Contains(string(encoded), "用户原创笔记项目") || !strings.Contains(string(encoded), "在家做手冲咖啡") {
			t.Fatal("original creation context missing")
		}
		return planReply(`{"titles":["在家冲一杯咖啡"]}`), nil
	})
	if _, err := a.runTitleRewrite(job); err != nil {
		t.Fatal(err)
	}
	result, _ := store.Get[textGeneration](a.Store.DB, "title_generations", jobID)
	if len(result.Titles) != 1 {
		t.Fatal("original title generation failed")
	}
}
