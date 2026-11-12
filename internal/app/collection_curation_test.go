package app

import (
	"reflect"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestNoteCurationPatchesAreDurableAndIndependent(t *testing.T) {
	a := testApp(t)
	id, _ := collectMediaFixture(t, a, "xhs", "curation")
	endpoint := "/collections/" + id
	request(t, a, "PATCH", endpoint, map[string]any{"tags": []string{"高赞", " 高赞 ", "旅行"}}, 200)
	request(t, a, "PATCH", endpoint, map[string]any{"rating": 5}, 200)
	request(t, a, "PATCH", endpoint, map[string]any{"rating": 6, "tags": []string{"should not save"}}, 400)
	request(t, a, "PATCH", endpoint, map[string]any{"rating": 1.5}, 400)
	request(t, a, "PATCH", endpoint, map[string]any{"tags": []string{"高粉"}}, 200)
	reopened, err := store.Open(a.Config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	note, err := store.Get[domain.Note](reopened.DB, "notes", id)
	if err != nil || note.Rating != 5 || !reflect.DeepEqual(note.Tags, []string{"高粉"}) {
		t.Fatal("independent metadata did not persist", note, err)
	}
	request(t, a, "PATCH", endpoint, map[string]any{"rating": 0}, 200)
	note, _ = store.Get[domain.Note](a.Store.DB, "notes", id)
	if note.Rating != 0 || len(note.Tags) != 1 {
		t.Fatal("clearing stars removed tags")
	}
}

func TestCollectionRatingSortingBodySearchAndTagOptions(t *testing.T) {
	a := testApp(t)
	first, _ := collectMediaFixture(t, a, "xhs", "first")
	second, _ := collectMediaFixture(t, a, "xhs", "second")
	request(t, a, "PATCH", "/collections/"+first, map[string]any{"rating": 2, "tags": []string{"高赞"}}, 200)
	request(t, a, "PATCH", "/collections/"+second, map[string]any{"rating": 5, "tags": []string{"高粉"}}, 200)
	n, _ := store.Get[domain.Note](a.Store.DB, "notes", second)
	rev, _ := store.Get[domain.Revision](a.Store.DB, "revisions", n.RevisionID)
	rev.Body = "正文独有关键词"
	rev.Topics = []string{"原始话题"}
	store.Put(a.Store.DB, "revisions", rev.ID, rev)
	result := decode[struct {
		Items []struct {
			domain.Note
			Body   string
			Topics []string
		}
		Tags []string
	}](t, request(t, a, "GET", "/collections?sort=rating&order=desc", nil, 200))
	if len(result.Items) != 2 || result.Items[0].ID != second || result.Items[0].Body != rev.Body || len(result.Items[0].Topics) != 1 || len(result.Tags) != 2 {
		t.Fatal("card metadata or rating sort missing", result)
	}
	result = decode[struct {
		Items []struct {
			domain.Note
			Body   string
			Topics []string
		}
		Tags []string
	}](t, request(t, a, "GET", "/collections?q=正文独有关键词", nil, 200))
	if len(result.Items) != 1 || result.Items[0].ID != second {
		t.Fatal("body search ignored")
	}
}

func TestCollectionBackfillOnlyQueuesActiveUncachedFiles(t *testing.T) {
	a := testApp(t)
	note, assets := collectMediaFixture(t, a, "xhs", "backfill")
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, j := range jobs {
		store.Delete(a.Store.DB, "jobs", j.ID)
	}
	v := assets[0]
	v.Status = "remote"
	v.LibraryState = ""
	store.Put(a.Store.DB, "assets", v.ID, v)
	v = assets[1]
	v.Status = "failed"
	store.Put(a.Store.DB, "assets", v.ID, v)
	a.mu.Lock()
	a.queueCollectionBackfill()
	a.queueCollectionBackfill()
	a.mu.Unlock()
	jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 1 || jobs[0].Target != assets[0].ID || jobs[0].Payload["trigger"] != "collection_auto" {
		t.Fatal("backfill duplicated work or retried failed file", jobs)
	}
	n, _ := store.Get[domain.Note](a.Store.DB, "notes", note)
	n.DeletedAt = Now()
	store.Put(a.Store.DB, "notes", n.ID, n)
	store.Delete(a.Store.DB, "jobs", jobs[0].ID)
	a.mu.Lock()
	a.queueCollectionBackfill()
	a.mu.Unlock()
	jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 0 {
		t.Fatal("deleted note backfilled")
	}
}
