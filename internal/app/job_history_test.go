package app

import (
	"reflect"
	"strconv"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestDeleteJobHistoryPreservesResultsAndActiveWork(t *testing.T) {
	a := testApp(t)
	asset := sampleImage(t, a)
	jobs := []domain.Job{}
	for _, state := range []string{"queued", "running", "succeeded", "blocked", "needs_review", "failed", "cancelled"} {
		j := newJob("download", asset.ID, map[string]any{"trigger": "manual"})
		j.Target = j.ID
		j.State, j.Result, j.Attempts = state, asset.ID, 1
		if err := store.Put(a.Store.DB, "jobs", j.ID, j); err != nil {
			t.Fatal(err)
		}
		jobs = append(jobs, j)
	}
	var ids []string
	for _, j := range jobs {
		ids = append(ids, j.ID)
	}
	before := decode[struct {
		Cursor int64
		Epoch  string
	}](t, request(t, a, "GET", "/sync", nil, 200))
	response := decode[struct {
		Deleted []string `json:"deleted_ids"`
		Active  []string `json:"skipped_active_ids"`
	}](t, request(t, a, "POST", "/jobs/history/delete", map[string]any{"ids": append(ids, ids[2])}, 200))
	if len(response.Deleted) != 5 || !reflect.DeepEqual(response.Active, ids[:2]) {
		t.Fatalf("unexpected deletion result: %+v", response)
	}
	for i, original := range jobs {
		stored := decode[domain.Job](t, request(t, a, "GET", "/jobs/"+original.ID, nil, 200))
		if (stored.HistoryDeletedAt != "") != (i >= 2) {
			t.Fatalf("wrong history visibility for %s", original.State)
		}
		stored.HistoryDeletedAt = ""
		if !reflect.DeepEqual(stored, original) {
			t.Fatal("history deletion changed execution data")
		}
	}
	got, err := store.Get[domain.Asset](a.Store.DB, "assets", asset.ID)
	if err != nil || !reflect.DeepEqual(got, asset) {
		t.Fatal("history deletion changed a generated asset")
	}
	// The persisted marker must reach other open clients through incremental sync.
	batch := decode[struct {
		Changes []struct {
			Entity string
			Value  domain.Job
		}
	}](t,
		request(t, a, "GET", "/sync?cursor="+strconv.FormatInt(before.Cursor, 10)+"&epoch="+before.Epoch, nil, 200))
	if len(batch.Changes) != 5 {
		t.Fatalf("expected 5 history changes, got %d", len(batch.Changes))
	}
	for _, change := range batch.Changes {
		if change.Entity != "jobs" || change.Value.HistoryDeletedAt == "" {
			t.Fatal("history marker missing from sync")
		}
	}
	request(t, a, "POST", "/jobs/history/delete", map[string]any{"ids": []string{ids[2]}}, 200)
	request(t, a, "POST", "/jobs/history/delete", map[string]any{"ids": ids[:2]}, 409)
	// Retrying a removed failed/blocked task makes it visible again.
	request(t, a, "POST", "/jobs/"+ids[3]+"/retry", nil, 202)
	retried, _ := store.Get[domain.Job](a.Store.DB, "jobs", ids[3])
	if retried.State != "queued" || retried.HistoryDeletedAt != "" {
		t.Fatal("retried task remained hidden")
	}
}

func TestDeleteJobHistoryValidatesAtomically(t *testing.T) {
	a := testApp(t)
	j := newJob("asr", "source", nil)
	j.State = "blocked"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/jobs/history/delete", map[string]any{"ids": []string{}}, 400)
	request(t, a, "POST", "/jobs/history/delete", map[string]any{"ids": []string{j.ID, "missing"}}, 404)
	stored, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if stored.HistoryDeletedAt != "" {
		t.Fatal("invalid batch partially deleted history")
	}
}
