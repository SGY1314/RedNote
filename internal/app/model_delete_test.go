package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestDeleteModelIsScopedAndEmptyCatalogSurvivesMigration(t *testing.T) {
	a := testApp(t)
	scopes := []string{"rewrite", "angle", "title", "copy", "image-plan", "image", "video-script", "video"}
	for _, scope := range scopes {
		store.Put(a.Store.DB, "settings", scope+"-models", []rewriteModel{{ID: "shared", Name: "同名配置", Service: domain.Service{BaseURL: "https://example.com/v1", Model: "model", Secret: "sealed"}}, {ID: "keep", Name: "保留"}})
	}
	for _, scope := range scopes {
		t.Run(scope, func(t *testing.T) {
			removed, e := a.deleteModelFor(scope, "shared")
			if e != nil || removed.ID != "shared" {
				t.Fatal(e)
			}
			list, e := a.modelsFor(scope)
			if e != nil || len(list) != 1 || list[0].ID != "keep" {
				t.Fatal("wrong model removed", e)
			}
			if _, e = a.deleteModelFor(scope, "shared"); e == nil {
				t.Fatal("missing model accepted")
			}
			if _, e = a.deleteModelFor(scope, "keep"); e != nil {
				t.Fatal(e)
			}
			a.initializeStageModels()
			list, e = a.modelsFor(scope)
			if e != nil || len(list) != 0 {
				t.Fatal("deleted models restored", e)
			}
		})
	}
	if _, e := a.deleteModelFor("bad-cap", "default"); e == nil {
		t.Fatal("unknown group accepted")
	}
}
func TestModelDeletionKeepsQueuedCredentialsAndHistory(t *testing.T) {
	a, p := stagedFixture(t)
	result := decode[map[string]string](t, request(t, a, "POST", "/rewrites/"+p.ID+"/titles/generate", map[string]any{"model_id": "initial"}, 202))
	jobID := result["job_id"]
	old, _ := store.Get[domain.Service](a.Store.DB, "settings", "title_rewrite-job-"+jobID)
	store.Put(a.Store.DB, "title_generations", "old-result", textGeneration{ID: "old-result", ProjectID: p.ID, Titles: []string{"历史结果"}})
	if _, e := a.deleteModelFor("title", "initial"); e != nil {
		t.Fatal(e)
	}
	saved, e := store.Get[domain.Service](a.Store.DB, "settings", "title_rewrite-job-"+jobID)
	if e != nil || saved.Secret != old.Secret || saved.Model != old.Model {
		t.Fatal("queued service changed", e)
	}
	job, e := store.Get[domain.Job](a.Store.DB, "jobs", jobID)
	if e != nil || job.State != "queued" {
		t.Fatal("queued task changed", e)
	}
	history, e := store.Get[textGeneration](a.Store.DB, "title_generations", "old-result")
	if e != nil || history.Titles[0] != "历史结果" {
		t.Fatal("history changed", e)
	}
	copies, e := a.modelsFor("copy")
	if e != nil || len(copies) != 1 || copies[0].ID != "initial" {
		t.Fatal("other group changed", e)
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/titles/generate", map[string]any{"model_id": "initial"}, 400)
}
