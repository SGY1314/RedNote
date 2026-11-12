package app

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestProjectDedupReusesSourceWithoutChangingWork(t *testing.T) {
	a := testApp(t)
	for _, platform := range []string{"xhs", "douyin"} {
		noteID, _ := collectMediaFixture(t, a, platform, "same-platform-id")
		p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": noteID}, 201))
		v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"title": "已有标题", "body": "已有文稿"}, 201))
		before, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
		// Recollection and a different requested medium must not replace the saved source or work.
		collectMediaFixture(t, a, platform, "same-platform-id")
		got := decode[struct {
			domain.Project
			Reused bool `json:"reused"`
		}](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": noteID, "name": "不能覆盖", "kind": "video"}, 200))
		after, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
		savedVersion, _ := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
		if !got.Reused || got.ID != p.ID || !reflect.DeepEqual(before, after) || !reflect.DeepEqual(v, savedVersion) {
			t.Fatal("duplicate changed existing work")
		}
	}
	projects, _ := store.List[domain.Project](a.Store.DB, "projects")
	if len(projects) != 2 {
		t.Fatal("expected one project per distinct platform note")
	}
	p := projects[0]
	request(t, a, "POST", "/rewrites/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
	replacement := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": p.NoteID}, 201))
	if replacement.ID == p.ID {
		t.Fatal("trash project should stay in trash")
	}
	original, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	if original.DeletedAt == "" {
		t.Fatal("creation restored trash unexpectedly")
	}
	request(t, a, "POST", "/rewrites", map[string]string{"note_id": p.NoteID}, 200)
	// Source-free creations are independent and not subject to note deduplication.
	one := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "新创作"}, 201))
	two := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "新创作"}, 201))
	if one.ID == two.ID {
		t.Fatal("source-free creations were deduplicated")
	}
}

func TestProjectDedupConcurrentRequests(t *testing.T) {
	a := testApp(t)
	noteID, _ := collectMediaFixture(t, a, "xhs", "concurrent")
	body, _ := json.Marshal(map[string]string{"note_id": noteID})
	router := a.Router()
	results := make(chan *httptest.ResponseRecorder, 8)
	for i := 0; i < 8; i++ {
		go func() {
			r := httptest.NewRequest("POST", "http://127.0.0.1:8080/api/v1/rewrites", bytes.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-CSRF-Token", a.CSRF)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			results <- w
		}()
	}
	created, ids := 0, map[string]bool{}
	for i := 0; i < 8; i++ {
		w := <-results
		if w.Code != 200 && w.Code != 201 {
			t.Fatalf("unexpected code %d: %s", w.Code, w.Body.String())
		}
		if w.Code == 201 {
			created++
		}
		p := decode[domain.Project](t, w.Body.Bytes())
		ids[p.ID] = true
	}
	projects, _ := store.List[domain.Project](a.Store.DB, "projects")
	if created != 1 || len(ids) != 1 || len(projects) != 1 {
		t.Fatal("concurrent requests created duplicates")
	}
}
