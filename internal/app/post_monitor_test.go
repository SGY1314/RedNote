package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func queuedMonitor(t *testing.T, a *App, account string) domain.Job {
	t.Helper()
	body := request(t, a, "POST", "/post-monitor/sync", map[string]string{"account_id": account}, 202)
	var out struct {
		ID string `json:"job_id"`
	}
	if e := json.Unmarshal(body, &out); e != nil {
		t.Fatal(e)
	}
	j, e := store.Get[domain.Job](a.Store.DB, "jobs", out.ID)
	if e != nil {
		t.Fatal(e)
	}
	return j
}
func finishMonitor(t *testing.T, a *App, j domain.Job) {
	t.Helper()
	j.State = "succeeded"
	if e := store.Put(a.Store.DB, "jobs", j.ID, j); e != nil {
		t.Fatal(e)
	}
}

func TestOwnPostsSnapshotsIsolationAndPartialReads(t *testing.T) {
	a := testApp(t)
	account := "account-a"
	id := "0123456789abcdef01234567"
	notes := []monitoredPost{{ID: id, AccountID: account, Title: "自己的帖子", Kind: "normal", DetailState: "ready", Metrics: postMetrics{Likes: "0", Favorites: "3", Comments: "", Shares: "1.2万"}}}
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/api/v1/monitor/own-notes" || r.Header.Get("Authorization") != "Bearer "+a.PublisherToken {
			t.Error("wrong monitor request")
		}
		var in map[string]string
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["account_id"] != account {
			t.Error("account not pinned")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"account_id": account, "username": "测试账号", "scope": "profile_loaded_max_20", "notes": notes, "params": map[string]string{"cookie": "SECRET"}}})
	}))
	defer s.Close()
	a.Config.PublisherURL = s.URL
	j := queuedMonitor(t, a, account)
	if other := queuedMonitor(t, a, account); j.ID != other.ID {
		t.Fatal("duplicate sync queued")
	}
	if _, e := a.runPostSync(j); e != nil {
		t.Fatal(e)
	}
	finishMonitor(t, a, j)
	got, e := store.Get[monitoredPost](a.Store.DB, "own_posts", account+":"+id)
	if e != nil {
		t.Fatal(e)
	}
	if got.Metrics.Likes != "0" || got.Metrics.Comments != "" || got.Metrics.Shares != "1.2万" || len(got.History) != 1 {
		t.Fatal("missing differs from zero", got)
	}
	notes[0].Metrics.Likes = "12"
	notes[0].Metrics.Views = "unexpected secret"
	notes[0].DetailState = "card_only"
	j = queuedMonitor(t, a, account)
	if _, e = a.runPostSync(j); e != nil {
		t.Fatal(e)
	}
	finishMonitor(t, a, j)
	got, _ = store.Get[monitoredPost](a.Store.DB, "own_posts", account+":"+id)
	if len(got.History) != 2 || got.History[0].Metrics.Likes != "0" || got.Metrics.Likes != "12" || got.Metrics.Views != "" {
		t.Fatal("snapshot history incorrect")
	}
	notes = []monitoredPost{}
	j = queuedMonitor(t, a, account)
	if _, e = a.runPostSync(j); e != nil {
		t.Fatal(e)
	}
	finishMonitor(t, a, j)
	retained, _ := store.Get[monitoredPost](a.Store.DB, "own_posts", account+":"+id)
	state, _ := store.Get[postSync](a.Store.DB, "post_syncs", account)
	if retained.LastSeen == state.LastSuccess || state.Count != 0 {
		t.Fatal("unseen note falsely updated or removed")
	}
	account = "account-b"
	notes = []monitoredPost{{ID: id, AccountID: account, Title: "另一账号", DetailState: "ready", Metrics: postMetrics{Likes: "2"}}}
	j = queuedMonitor(t, a, account)
	if _, e = a.runPostSync(j); e != nil {
		t.Fatal(e)
	}
	body := request(t, a, "GET", "/post-monitor?account_id=account-b", nil, 200)
	if strings.Contains(string(body), "自己的帖子") || strings.Contains(string(body), "SECRET") {
		t.Fatal("account content or secret leaked")
	}
	if calls != 4 {
		t.Fatal("unexpected repeat request", calls)
	}
}

func TestOwnPostsRejectWrongAccountAndKeepOldData(t *testing.T) {
	a := testApp(t)
	id := "0123456789abcdef01234567"
	old := monitoredPost{ID: id, AccountID: "owner", Title: "原记录", LastSeen: "old"}
	_ = store.Put(a.Store.DB, "own_posts", "owner:"+id, old)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"account_id": "owner", "scope": "profile_loaded_max_20", "notes": []monitoredPost{{ID: id, AccountID: "someone-else", DetailState: "ready"}}}})
	}))
	defer s.Close()
	a.Config.PublisherURL = s.URL
	j := queuedMonitor(t, a, "owner")
	stale, _ := store.Get[postSync](a.Store.DB, "post_syncs", "owner")
	stale.JobID = "another-completed-attempt"
	_ = store.Put(a.Store.DB, "post_syncs", "owner", stale)
	if _, e := a.runPostSync(j); e == nil {
		t.Fatal("foreign note accepted")
	}
	got, _ := store.Get[monitoredPost](a.Store.DB, "own_posts", "owner:"+id)
	state, _ := store.Get[postSync](a.Store.DB, "post_syncs", "owner")
	if state.JobID != j.ID {
		t.Fatal("retry not linked to current sync attempt")
	}
	if got.Title != "原记录" || got.LastSeen != "old" || state.LastSuccess != "" || state.LastError == "" {
		t.Fatal("failed sync overwrote cache")
	}
	request(t, a, "POST", "/post-monitor/sync", map[string]string{"account_id": "../invalid"}, 400)
}

func TestOwnPostsHistoryBoundAndRestart(t *testing.T) {
	a := testApp(t)
	id := "0123456789abcdef01234567"
	old := monitoredPost{ID: id, AccountID: "owner", History: make([]postSample, 30)}
	old.History[0].At = "discard"
	old.History[1].At = "keep"
	_ = store.Put(a.Store.DB, "own_posts", "owner:"+id, old)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"account_id": "owner", "scope": "profile_loaded_max_20", "notes": []monitoredPost{{ID: id, AccountID: "owner", DetailState: "ready"}}}})
	}))
	defer s.Close()
	a.Config.PublisherURL = s.URL
	j := queuedMonitor(t, a, "owner")
	if _, e := a.runPostSync(j); e != nil {
		t.Fatal(e)
	}
	got, _ := store.Get[monitoredPost](a.Store.DB, "own_posts", "owner:"+id)
	if len(got.History) != 30 || got.History[0].At != "keep" {
		t.Fatal("history not bounded")
	}
	j.State = "running"
	_ = store.Put(a.Store.DB, "jobs", j.ID, j)
	a.StartWorkers()
	restored, _ := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if restored.State != "queued" {
		t.Fatal("read-only job not restored")
	}
}
