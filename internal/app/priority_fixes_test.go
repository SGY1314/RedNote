package app

import (
	"bytes"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestUsageKeepsHiddenHistoryAndDoesNotChargeUntouchedJobs(t *testing.T) {
	for _, state := range []string{"queued", "cancelled", "blocked", "failed"} {
		record := estimateJobUsage(AuthUser{}, domain.Job{Kind: "image_generation", State: state}, 1)
		if record.Total != 0 || record.Cost != 0 {
			t.Fatalf("unexecuted %s counted: %+v", state, record)
		}
	}
	// Even a worker attempt can stop at configuration validation.
	if r := estimateJobUsage(AuthUser{}, domain.Job{Kind: "ocr", State: "blocked", Attempts: 1}, 1); r.Total != 0 {
		t.Fatal("configuration failure counted")
	}
	for _, state := range []string{"failed", "cancelled", "needs_review"} {
		r := estimateJobUsage(AuthUser{}, domain.Job{Kind: "image_generation", State: state, Attempts: 1}, 1)
		if r.Total <= 0 {
			t.Fatal("executed ambiguous attempt silently made free:", state)
		}
	}
	m, token, csrf := newMultiUserFixture(t, "creator")
	var uid string
	if err := m.AuthDB.QueryRow("SELECT id FROM users WHERE role='creator' LIMIT 1").Scan(&uid); err != nil {
		t.Fatal(err)
	}
	a, err := m.userApp(uid)
	if err != nil {
		t.Fatal(err)
	}
	job := newJob("image_generation", "usage-test", nil)
	job.State = "succeeded"
	if err := store.Put(a.Store.DB, "jobs", job.ID, job); err != nil {
		t.Fatal(err)
	}
	type response struct {
		Usage   []usageRecord
		Summary adminSummary
	}
	before := decode[response](t, multiUserRequest(t, m, "GET", "/usage", token, "", nil).Body.Bytes())
	if len(before.Usage) != 1 || before.Summary.Calls != 1 || before.Summary.Tokens <= 0 {
		t.Fatalf("missing initial usage: %+v", before)
	}
	deleted := multiUserRequest(t, m, "POST", "/jobs/history/delete", token, csrf, map[string]any{"ids": []string{job.ID}})
	if deleted.Code != 200 {
		t.Fatal(deleted.Code, deleted.Body.String())
	}
	after := decode[response](t, multiUserRequest(t, m, "GET", "/usage", token, "", nil).Body.Bytes())
	if len(after.Usage) != 1 || after.Summary.Tokens != before.Summary.Tokens {
		t.Fatal("history deletion changed user usage")
	}
	_, adminUsage, tasks, summary := m.collectAdminData()
	if len(adminUsage) != 1 || len(tasks) != 0 || summary.Tokens != before.Summary.Tokens {
		t.Fatal("admin usage and task visibility were coupled")
	}
}

func TestResolveLegacyPreparedDraftWithoutJob(t *testing.T) {
	for _, state := range []string{"prepared", "manual_review"} {
		t.Run(state, func(t *testing.T) {
			a := testApp(t)
			p := publishFixture(t, a)
			p.OnlineState = state
			if err := store.Put(a.Store.DB, "publications", p.ID, p); err != nil {
				t.Fatal(err)
			}
			var uploads atomic.Int32
			mockPublisher(t, a, "fixture", true, &uploads)
			result := decode[domain.Publication](t, request(t, a, "POST", "/publications/"+p.ID+"/resolve", map[string]bool{"not_published": true}, 200))
			if result.OnlineState != "failed" || uploads.Load() != 0 {
				t.Fatal("recovery did not reset without uploading")
			}
		})
	}
	a := testApp(t)
	p := publishFixture(t, a)
	p.OnlineState = "prepared"
	store.Put(a.Store.DB, "publications", p.ID, p)
	job := newJob("publish", p.ID, nil)
	job.State = "running"
	store.Put(a.Store.DB, "jobs", job.ID, job)
	request(t, a, "POST", "/publications/"+p.ID+"/resolve", map[string]bool{"not_published": true}, 409)
	job.State = "failed"
	store.Put(a.Store.DB, "jobs", job.ID, job)
	p.ManualStatus = "published"
	store.Put(a.Store.DB, "publications", p.ID, p)
	request(t, a, "POST", "/publications/"+p.ID+"/resolve", map[string]bool{"not_published": true}, 409)
}

func TestManualPublishedRevokesLiveQRAndRejectsRecreation(t *testing.T) {
	a, p, uploads, server := mobileFixture(t)
	base := "/publications/" + p.ID
	created := decode[miniappCloudSession](t, request(t, a, "POST", base+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("a", 32)}, 201))
	marked := decode[domain.Publication](t, request(t, a, "POST", base+"/status", map[string]any{"status": "published", "revision": p.Revision}, 200))
	if marked.ManualStatus != "published" {
		t.Fatal("status not saved")
	}
	local, _ := store.Get[mobileHandoffRecord](a.Store.DB, "mobile_handoffs", p.ID)
	if local.Session.State != "cancelled" {
		t.Fatal("QR not cancelled")
	}
	body := bytes.NewBufferString(`{"ticket":"` + created.Ticket + `"}`)
	res, err := http.Post(server.URL+"/v1/development/open", "application/json", body)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == 200 {
		t.Fatal("revoked ticket still opens")
	}
	request(t, a, "POST", base+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("a", 32)}, 409)
	request(t, a, "POST", base+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("b", 32)}, 409)
	if uploads.Load() != 1 {
		t.Fatal("published draft reuploaded")
	}
}

func TestManualPublishedCancellationFailureKeepsOriginalStatus(t *testing.T) {
	for _, unknown := range []bool{false, true} {
		a, p, _, server := mobileFixture(t)
		base := "/publications/" + p.ID
		if unknown {
			store.Put(a.Store.DB, "mobile_handoffs", p.ID, mobileHandoffRecord{Session: miniappCloudSession{ID: ID(), State: "unknown", ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}})
		} else {
			request(t, a, "POST", base+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("c", 32)}, 201)
			server.Close()
		}
		request(t, a, "POST", base+"/status", map[string]any{"status": "published", "revision": p.Revision}, 409)
		latest, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
		if latest.ManualStatus != "" || latest.Revision != p.Revision {
			t.Fatal("failed cancellation changed publication")
		}
	}
}
