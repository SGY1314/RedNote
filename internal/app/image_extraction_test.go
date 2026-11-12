package app

import (
	"bytes"
	"io"
	"net/http"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestImageDownloadDoesNotScheduleOCR(t *testing.T) {
	a := testApp(t)
	fixture := sampleImage(t, a)
	f, err := a.openMedia(fixture.Path)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(f)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	v := domain.Asset{ID: ID(), Kind: "image", Status: "pending", RemoteURL: "https://sns-webpic.xhscdn.com/fixture.png"}
	store.Put(a.Store.DB, "assets", v.ID, v)
	client := &http.Client{Transport: mediaTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(data)), Header: make(http.Header)}, nil
	})}
	if _, err = a.runDownloadWithClient(newJob("download", v.ID, nil), client); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Get[domain.Asset](a.Store.DB, "assets", v.ID)
	if got.Status != "ready" {
		t.Fatal("image not downloaded")
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 0 {
		t.Fatal("download automatically enqueued extraction")
	}
}

func TestSelectedImagesOnlyAndManualRetry(t *testing.T) {
	a := testApp(t)
	first, second, unselected := sampleImage(t, a), sampleImage(t, a), sampleImage(t, a)
	request(t, a, "POST", "/assets/batch-extract", map[string]any{"ids": []string{first.ID, "missing"}}, 404)
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 0 {
		t.Fatal("invalid batch partially submitted")
	}
	video := domain.Asset{ID: ID(), Kind: "video", Status: "ready"}
	store.Put(a.Store.DB, "assets", video.ID, video)
	request(t, a, "POST", "/assets/batch-extract", map[string]any{"ids": []string{video.ID}}, 400)
	request(t, a, "POST", "/assets/batch-extract", map[string]any{"ids": []string{first.ID, second.ID, first.ID}}, 202)
	request(t, a, "POST", "/assets/batch-extract", map[string]any{"ids": []string{first.ID, second.ID}}, 202)
	jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 2 {
		t.Fatal("duplicate tasks created")
	}
	for _, j := range jobs {
		if j.Kind != "ocr" || asString(j.Payload["trigger"]) != "manual" || j.Target == unselected.ID {
			t.Fatal("unselected image or nonmanual task")
		}
	}
	request(t, a, "POST", "/assets/"+unselected.ID+"/extract", nil, 202)
	jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 3 {
		t.Fatal("single image extraction failed")
	}
	for _, j := range jobs {
		if asString(j.Payload["trigger"]) != "manual" {
			t.Fatal("manual marker missing")
		}
	}
	old := newJob("ocr", ID(), nil)
	old.State = "blocked"
	store.Put(a.Store.DB, "jobs", old.ID, old)
	request(t, a, "POST", "/jobs/"+old.ID+"/retry", nil, 202)
	got, _ := store.Get[domain.Job](a.Store.DB, "jobs", old.ID)
	if asString(got.Payload["trigger"]) != "manual" {
		t.Fatal("explicit retry not marked manual")
	}
}

func TestStartupCancelsLegacyAutomaticOCR(t *testing.T) {
	a := testApp(t)
	for _, state := range []string{"queued", "blocked", "failed", "succeeded"} {
		j := newJob("ocr", ID(), nil)
		j.State = state
		j.ID = state
		store.Put(a.Store.DB, "jobs", j.ID, j)
	}
	manual := newJob("ocr", ID(), map[string]any{"trigger": "manual"})
	manual.State = "blocked"
	store.Put(a.Store.DB, "jobs", manual.ID, manual)
	a.StartWorkers()
	for _, id := range []string{"queued", "blocked", "failed"} {
		j, _ := store.Get[domain.Job](a.Store.DB, "jobs", id)
		if j.State != "cancelled" {
			t.Fatal("legacy automatic OCR still active", id, j.State)
		}
	}
	for _, id := range []string{"succeeded", manual.ID} {
		j, _ := store.Get[domain.Job](a.Store.DB, "jobs", id)
		if j.State == "cancelled" {
			t.Fatal("history or explicit task was cancelled")
		}
	}
}
