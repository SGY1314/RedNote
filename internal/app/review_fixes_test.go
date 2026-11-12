package app

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestReviewFixImageDownloadRetryCompletesWithoutGeneration(t *testing.T) {
	a := testApp(t)
	_, _, j := imageJobFixture(t, a)
	image := sampleImage(t, a)
	f, e := a.openMedia(image.Path)
	if e != nil {
		t.Fatal(e)
	}
	data, _ := io.ReadAll(f)
	f.Close()
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	posts, gets := 0, 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		posts++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[{"url":"https://example.com/generated.png?signature=private"}]}`))}, nil
	})
	client := &http.Client{Transport: rewriteTransport(func(r *http.Request) (*http.Response, error) {
		gets++
		if r.Method != "GET" || r.Header.Get("Authorization") != "" {
			t.Fatal("unsafe download request")
		}
		if gets == 1 {
			return nil, errors.New("download disconnected")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(data))}, nil
	})}
	if _, e := a.runImageFrameWithClient(j, j.ID, "", client); e == nil {
		t.Fatal("download should fail first")
	}
	id, e := a.runImageFrameWithClient(j, j.ID, "", client)
	if e != nil || id != j.ID || posts != 1 || gets != 2 {
		t.Fatalf("retry failed or regenerated: id=%s posts=%d gets=%d error=%v", id, posts, gets, e)
	}
	saved, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
	if e != nil || saved.Status != "ready" {
		t.Fatal("download did not persist real asset")
	}
}

func TestReviewFixReferenceRefreshPreservesVersions(t *testing.T) {
	a := testApp(t)
	rev := domain.Revision{ID: ID(), Title: "来源", Body: "固定原文", Kind: "image", AssetIDs: []string{"image-ref"}}
	note := domain.Note{ID: ID(), Platform: "xhs", NoteID: "fixture-note", RevisionID: rev.ID}
	if e := store.Put(a.Store.DB, "revisions", rev.ID, rev); e != nil {
		t.Fatal(e)
	}
	if e := store.Put(a.Store.DB, "notes", note.ID, note); e != nil {
		t.Fatal(e)
	}
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": note.ID}, 201))
	if len(p.Sources) != 1 {
		t.Fatal("unexpected initial extraction")
	}
	ex := domain.Extraction{ID: ID(), AssetID: "image-ref", Kind: "ocr", Text: "识别后的文字"}
	store.Put(a.Store.DB, "extractions", ex.ID, ex)
	p = decode[domain.Project](t, request(t, a, "POST", "/rewrites/"+p.ID+"/refresh-sources", nil, 200))
	if len(p.Sources) != 2 || p.Sources[1].Text != ex.Text {
		t.Fatal("late OCR unavailable")
	}
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]any{"title": "我的文稿", "body": "保留编辑", "source_ids": []string{ex.ID}}, 201))
	ex.Text = "人工修正后的文字"
	store.Put(a.Store.DB, "extractions", ex.ID, ex)
	p = decode[domain.Project](t, request(t, a, "POST", "/rewrites/"+p.ID+"/refresh-sources", nil, 200))
	old, e := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	if e != nil || old.Body != "保留编辑" || len(old.SourceSnapshot) != 1 || old.SourceSnapshot[0].Text != "识别后的文字" || p.Sources[1].Text != ex.Text {
		t.Fatal("refresh changed version snapshot or failed to update text")
	}
}

func TestReviewFixQueueFiltersKindStateAndKeepsFIFO(t *testing.T) {
	a := testApp(t)
	for _, j := range []domain.Job{
		{ID: "other", Kind: "collect", State: "queued"},
		{ID: "failed", Kind: "ocr", State: "failed"},
		{ID: "first", Kind: "ocr", State: "queued"},
		{ID: "second", Kind: "ocr", State: "queued"},
	} {
		if e := store.Put(a.Store.DB, "jobs", j.ID, j); e != nil {
			t.Fatal(e)
		}
	}
	next, e := store.NextJob[domain.Job](a.Store.DB, "ocr")
	if e != nil || next.ID != "first" {
		t.Fatal("wrong queued job")
	}
	next.State = "running"
	store.Put(a.Store.DB, "jobs", next.ID, next)
	next, e = store.NextJob[domain.Job](a.Store.DB, "ocr")
	if e != nil || next.ID != "second" {
		t.Fatal("claimed job selected again")
	}
	if _, e = store.NextJob[domain.Job](a.Store.DB, "asr"); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("empty queue returned a job")
	}
}

func TestReviewFixVideoNewAttemptReusesShotsAndFreezesNewConfig(t *testing.T) {
	a := testApp(t)
	p, s, m := directorFixture(t, a)
	j := startDirectorVideo(t, a, p, s, m)
	asset := sampleImage(t, a)
	var prev videoProduction
	decodeVideoPayload(j, "production", &prev)
	prev.Shots[0] = videoClip{AssetID: asset.ID, State: "succeeded", RemoteID: "done-1"}
	prev.Shots[1] = videoClip{State: "failed", RemoteID: "failed-2"}
	j.Payload["production"] = prev
	j.State = "failed"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "PUT", "/video-models/"+m.ID, map[string]string{"name": "新模型", "model": "new-model", "base_url": "https://example.com/api/v3", "secret": "new-key"}, 200)
	input := map[string]any{"script_id": s.ID, "model_id": m.ID, "audio": true, "previous_job_id": j.ID, "redo_shot": 1, "request_id": "retry-fixture"}
	path := "/rewrites/" + p.ID + "/video/generate"
	result := decode[map[string]string](t, request(t, a, "POST", path, input, 202))
	same := decode[map[string]string](t, request(t, a, "POST", path, input, 202))
	if result["job_id"] == j.ID || same["job_id"] != result["job_id"] {
		t.Fatal("new attempt missing or duplicate created")
	}
	next, _ := store.Get[domain.Job](a.Store.DB, "jobs", result["job_id"])
	var prod videoProduction
	decodeVideoPayload(next, "production", &prod)
	svc, _ := store.Get[domain.Service](a.Store.DB, "settings", "video-job-"+next.ID)
	if prod.Shots[0].AssetID != asset.ID || prod.Shots[1].RemoteID != "" || svc.Model != "new-model" {
		t.Fatal("reuse or config snapshot invalid")
	}
	transport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = transport })
	posts := 0
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method != "POST" {
			t.Fatal("reused shot was polled")
		}
		posts++
		return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
	})
	if _, e := a.runVideoGenerate(next); e == nil || posts != 1 {
		t.Fatal("completed shot was regenerated")
	}
	next, _ = store.Get[domain.Job](a.Store.DB, "jobs", next.ID)
	next.State = "failed"
	store.Put(a.Store.DB, "jobs", next.ID, next)
	old, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	var original videoProduction
	decodeVideoPayload(old, "production", &original)
	if original.Shots[1].RemoteID != "failed-2" {
		t.Fatal("old production mutated")
	}
	original.Shots[1] = videoClip{State: "submitting"}
	old.Payload["production"] = original
	store.Put(a.Store.DB, "jobs", old.ID, old)
	input["request_id"] = "unknown-guard"
	request(t, a, "POST", path, input, 409)
}

func TestReviewFixImageDownloadReceiptPreventsPaidRetry(t *testing.T) {
	a := testApp(t)
	p, _, j := imageJobFixture(t, a)
	transport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = transport })
	posts := 0
	// A provider URL pointing at loopback is rejected before any download.
	// Crucially, even this failed download must not call generation again.
	rawURL := "https://127.0.0.1/image.png?signature=private-fixture"
	http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
		posts++
		b, _ := json.Marshal(map[string]any{"data": []any{map[string]string{"url": rawURL}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(b)))}, nil
	})
	for i := 0; i < 2; i++ {
		if _, e := a.runImageFrame(j, j.ID, ""); e == nil {
			t.Fatal("invalid download accepted")
		}
	}
	receipt, e := store.Get[imageDownloadReceipt](a.Store.DB, "settings", "image-result-"+j.ID)
	if e != nil || posts != 1 || receipt.URL == rawURL {
		t.Fatal("paid retry or plaintext receipt")
	}
	decoded, e := adapter.Unseal(receipt.URL)
	if e != nil || decoded != rawURL {
		t.Fatal("receipt lost")
	}
	public := string(request(t, a, "GET", "/jobs", nil, 200)) + string(request(t, a, "GET", "/sync", nil, 200))
	if strings.Contains(public, "private-fixture") {
		t.Fatal("signed URL leaked")
	}
	j.State = "failed"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/rewrites/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 200)
	if _, e := store.Get[imageDownloadReceipt](a.Store.DB, "settings", "image-result-"+j.ID); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("orphan receipt")
	}
}

func TestReviewFixIncrementalSyncPagesUpdatesDeletesAndRollback(t *testing.T) {
	a := testApp(t)
	for i := 0; i < 205; i++ {
		id := fmt.Sprintf("asset-%03d", i)
		if e := store.Put(a.Store.DB, "assets", id, domain.Asset{ID: id, Name: "原名"}); e != nil {
			t.Fatal(e)
		}
	}
	store.Put(a.Store.DB, "settings", "private", map[string]string{"secret": "never-public"})
	type batch struct {
		Changes []syncChange `json:"changes"`
		Cursor  int64        `json:"cursor"`
		Epoch   string       `json:"epoch"`
		Reset   bool         `json:"reset"`
		More    bool         `json:"more"`
	}
	first := decode[batch](t, request(t, a, "GET", "/sync", nil, 200))
	if !first.Reset || !first.More || len(first.Changes) != 200 {
		t.Fatal("initial page invalid")
	}
	query := func(cursor int64) string { return fmt.Sprintf("/sync?cursor=%d&epoch=%s", cursor, first.Epoch) }
	last := decode[batch](t, request(t, a, "GET", query(first.Cursor), nil, 200))
	if last.Reset || last.More || len(last.Changes) != 5 {
		t.Fatal("second page invalid")
	}
	if len(decode[batch](t, request(t, a, "GET", query(last.Cursor), nil, 200)).Changes) != 0 {
		t.Fatal("idle sync returned history")
	}
	store.Put(a.Store.DB, "assets", "asset-000", domain.Asset{ID: "asset-000", Name: "改名1"})
	store.Put(a.Store.DB, "assets", "asset-000", domain.Asset{ID: "asset-000", Name: "改名2"})
	store.Delete(a.Store.DB, "assets", "asset-001")
	a.Store.Transaction(func(tx *sql.Tx) error {
		store.Put(tx, "assets", "rollback", domain.Asset{ID: "rollback"})
		return errors.New("rollback")
	})
	delta := decode[batch](t, request(t, a, "GET", query(last.Cursor), nil, 200))
	if len(delta.Changes) != 2 || !strings.Contains(string(delta.Changes[0].Value), "改名2") || string(delta.Changes[1].Value) != "null" {
		t.Fatal("updates, tombstones or rollback incorrect")
	}
	reset := decode[batch](t, request(t, a, "GET", "/sync?cursor=999999&epoch=old-server", nil, 200))
	if !reset.Reset || len(reset.Changes) != 200 {
		t.Fatal("server restart did not reset cursor")
	}
}
