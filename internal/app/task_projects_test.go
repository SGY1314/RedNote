package app

import (
	"encoding/json"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestTaskProjectsJoinCollectionAssetsAndKeepCategories(t *testing.T) {
	a := testApp(t)
	note := domain.Note{ID: "task-note", Title: "一份笔记的采集", URL: "https://www.xiaohongshu.com/explore/task-note", RevisionID: "task-revision"}
	rev := domain.Revision{ID: note.RevisionID, NoteID: note.ID, Title: note.Title}
	asset := domain.Asset{ID: "task-asset", Name: "封面.png", Source: "collection", RevisionID: rev.ID, Kind: "image"}
	project := domain.Project{ID: "task-rewrite", Name: "咖啡仿写项目"}
	publication := domain.Publication{ID: "task-publication", Content: domain.Content{Title: "咖啡发布稿"}, ProjectID: project.ID}
	for table, record := range map[string]any{"notes": note, "revisions": rev, "assets": asset, "projects": project, "publications": publication} {
		id := map[string]string{"notes": note.ID, "revisions": rev.ID, "assets": asset.ID, "projects": project.ID, "publications": publication.ID}[table]
		if err := store.Put(a.Store.DB, table, id, record); err != nil {
			t.Fatal(err)
		}
	}
	collect := newJob("collect", note.URL, nil)
	collect.Result = note.ID
	collect.State = "succeeded"
	download := newJob("download", asset.ID, nil)
	download.State = "failed"
	download.Error = "素材源地址失效"
	rewrite := newJob("title_rewrite", project.ID, nil)
	publish := newJob("publish", publication.ID, nil)
	for _, j := range []domain.Job{collect, download, rewrite, publish} {
		if err := store.Put(a.Store.DB, "jobs", j.ID, j); err != nil {
			t.Fatal(err)
		}
	}
	jobs := decode[[]domain.Job](t, request(t, a, "GET", "/jobs", nil, 200))
	refs := map[string]*domain.TaskProjectRef{}
	for _, j := range jobs {
		refs[j.ID] = j.TaskProject
	}
	if refs[collect.ID].Category != "collect" || refs[collect.ID].ID != note.ID || refs[download.ID].ID != note.ID || refs[download.ID].ItemName != asset.Name || refs[download.ID].CurrentRevisionID != rev.ID {
		t.Fatal("collection downloads were not assigned to their note", refs)
	}
	if refs[rewrite.ID].Category != "rewrite" || refs[rewrite.ID].Name != project.Name || refs[publish.ID].Category != "publish" || refs[publish.ID].Name != publication.Title {
		t.Fatal("task project categories or names incorrect", refs)
	}
	stored, _ := store.Get[domain.Job](a.Store.DB, "jobs", download.ID)
	if stored.TaskProject != nil || stored.Error != download.Error {
		t.Fatal("display metadata mutated execution record")
	}
	var batch struct {
		Changes []struct {
			Entity string          `json:"entity"`
			ID     string          `json:"id"`
			Value  json.RawMessage `json:"value"`
		} `json:"changes"`
	}
	batch = decode[struct {
		Changes []struct {
			Entity string          `json:"entity"`
			ID     string          `json:"id"`
			Value  json.RawMessage `json:"value"`
		} `json:"changes"`
	}](t, request(t, a, "GET", "/sync?cursor=0", nil, 200))
	found := false
	for _, change := range batch.Changes {
		if change.Entity == "jobs" && change.ID == download.ID {
			j := decode[domain.Job](t, change.Value)
			found = j.TaskProject != nil && j.TaskProject.ID == note.ID && j.Error == download.Error
		}
	}
	if !found {
		t.Fatal("incremental job updates lost project context or failure")
	}
}
