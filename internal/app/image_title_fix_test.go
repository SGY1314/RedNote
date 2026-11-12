package app

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestImageProjectRepairPreservesResultsAndIsIdempotent(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "恢复图片"}, 201))
	assets := []domain.Asset{
		{ID: "single", Kind: "image", Source: "generated", Status: "ready", Path: "original.png", LibraryState: "result"},
		{ID: "series-1", Kind: "image", Source: "generated", LibraryState: "saved"},
		{ID: "series-2", Kind: "image", Source: "generated", DeletedAt: "deleted"},
		{ID: "uploaded", Kind: "image", Source: "upload"},
		{ID: "owned", Kind: "image", Source: "generated", ProjectID: "other-project"},
	}
	for _, v := range assets {
		if err := store.Put(a.Store.DB, "assets", v.ID, v); err != nil {
			t.Fatal(err)
		}
	}
	jobs := []domain.Job{
		{ID: "single", Kind: "image_generation", Target: p.ID, State: "succeeded", Result: "single"},
		{ID: "series", Kind: "image_generation", Target: p.ID, State: "failed", Payload: map[string]any{"series": imageSeries{AssetIDs: []string{"series-1", "series-2"}, Scenes: []string{"a", "b"}}}},
		{ID: "uploaded-job", Kind: "image_generation", Target: p.ID, Result: "uploaded"},
		{ID: "owned-job", Kind: "image_generation", Target: p.ID, Result: "owned"},
	}
	for _, j := range jobs {
		store.Put(a.Store.DB, "jobs", j.ID, j)
	}
	for range 2 {
		if err := a.repairImageProjectLinks(); err != nil {
			t.Fatal(err)
		}
	}
	for i, original := range assets {
		v, err := store.Get[domain.Asset](a.Store.DB, "assets", original.ID)
		if err != nil {
			t.Fatal(err)
		}
		if i < 3 {
			if v.ProjectID != p.ID || v.ProjectName != p.Name {
				t.Fatalf("unlinked result: %+v", v)
			}
		} else if v.ProjectID != original.ProjectID {
			t.Fatal("unrelated asset changed")
		}
		if v.Path != original.Path || v.LibraryState != original.LibraryState || v.DeletedAt != original.DeletedAt {
			t.Fatal("file/library/history changed")
		}
	}
}

func TestXHSTitleTwentyCharacterBoundary(t *testing.T) {
	a, p := stagedFixture(t)
	base := "/rewrites/" + p.ID
	request(t, a, "POST", base+"/titles/confirm", map[string]string{"text": strings.Repeat("中", 20)}, 200)
	request(t, a, "POST", base+"/titles/confirm", map[string]string{"text": strings.Repeat("中", 21)}, 400)
	request(t, a, "POST", base+"/titles/confirm", map[string]string{"text": strings.Repeat("中", 19) + "😊"}, 200)
	request(t, a, "POST", base+"/titles/confirm", map[string]string{"text": strings.Repeat("中", 20) + "!"}, 400)
	request(t, a, "POST", base+"/versions", map[string]string{"title": strings.Repeat("中", 21), "body": "正文"}, 400)
	w, _ := a.readWorkflow(p.ID)
	w.Title.Text = strings.Repeat("中", 21)
	w.Copy = workflowCopy{Key: "copy", TitleKey: w.Title.Key, Body: "已有正文"}
	store.Put(a.Store.DB, "creation_workflows", p.ID, w)
	request(t, a, "POST", base+"/workflow/release", map[string]any{"copy_key": "copy", "media_reviewed": true, "media": map[string]any{"kind": "image", "asset_ids": []string{}}}, 400)
	if validateProjectTitle(domain.Project{Platform: "douyin"}, strings.Repeat("中", 21)) != nil {
		t.Fatal("XHS limit applied to Douyin")
	}
}

func TestXHSTitleGenerationRejectsOversizedCandidate(t *testing.T) {
	a, p := stagedFixture(t)
	result := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/titles/generate", map[string]string{"model_id": "initial"}, 202))
	job, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		return planReply(fmt.Sprintf(`{"titles":["%s","第二个标题","第三个标题"]}`, strings.Repeat("中", 21))), nil
	})
	if _, err := a.execute(job); err == nil || !strings.Contains(err.Error(), "20字") {
		t.Fatalf("oversized model result accepted: %v", err)
	}
	records, _ := store.List[textGeneration](a.Store.DB, "title_generations")
	if len(records) != 0 {
		t.Fatal("invalid candidate stored as success")
	}
}
