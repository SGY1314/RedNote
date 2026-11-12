package app

import (
	"strings"
	"testing"
	"time"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func replacementFixture(t *testing.T) (*App, domain.Project, domain.Publication, domain.Publication) {
	t.Helper()
	a, p, _ := stageSourceFixture(t)
	endpoint := "/rewrites/" + p.ID + "/workflow/stage"
	first := decode[stageReply](t, request(t, a, "POST", endpoint, workflowStageRequest{Step: "title", Text: "旧稿标题", Publish: true}, 201))
	old := confirmPreparedTest(t, a, first.Publications[0])
	review := decode[stageReply](t, request(t, a, "POST", endpoint, workflowStageRequest{Step: "copy", Text: "新稿的完整正文", Topics: []string{"新话题"}, TitleKey: first.Workflow.Title.Key, Publish: true}, 201))
	return a, p, old, review.Publications[0]
}

func TestPublicationReplacementCommitAndRestore(t *testing.T) {
	a, _, old, review := replacementFixture(t)
	// Preparing or abandoning a review must leave the old record intact.
	before, _ := store.Get[domain.Publication](a.Store.DB, "publications", old.ID)
	if before.DeletedAt != "" || before.Body != old.Body {
		t.Fatal("preview mutated old publication")
	}
	// Published history and a different platform are never archived.
	historical := old
	historical.ID = ID()
	historical.ManualStatus = "published"
	store.Put(a.Store.DB, "publications", historical.ID, historical)
	dy := old
	dy.ID = ID()
	dy.TargetPlatform = "douyin"
	store.Put(a.Store.DB, "publications", dy.ID, dy)
	latest := confirmPreparedTest(t, a, review)
	archived, _ := store.Get[domain.Publication](a.Store.DB, "publications", old.ID)
	if latest.ID == old.ID || archived.DeletedAt == "" || archived.Body != old.Body || archived.VersionID != old.VersionID {
		t.Fatal("old content overwritten or not archived")
	}
	for _, id := range []string{historical.ID, dy.ID} {
		saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", id)
		if saved.DeletedAt != "" {
			t.Fatal("unrelated history/platform archived")
		}
	}
	list := decode[[]domain.Publication](t, request(t, a, "GET", "/publications", nil, 200))
	for _, p := range list {
		if p.ID == old.ID {
			t.Fatal("old publication still listed")
		}
	}
	trashed := decode[[]domain.Publication](t, request(t, a, "GET", "/publications?deleted=true", nil, 200))
	if len(trashed) != 1 || trashed[0].ID != old.ID {
		t.Fatal("old publication missing from trash")
	}
	// Sync must deliver an update marking the old record deleted, not resurrect it.
	raw := request(t, a, "GET", "/sync", nil, 200)
	if !strings.Contains(string(raw), old.ID) || !strings.Contains(string(raw), archived.DeletedAt) {
		t.Fatal("archive not synchronized")
	}
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{old.ID}, "deleted": false}, 409)
	still, _ := store.Get[domain.Publication](a.Store.DB, "publications", old.ID)
	if still.DeletedAt == "" {
		t.Fatal("conflicting restore succeeded")
	}
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{latest.ID}, "deleted": true}, 200)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{old.ID}, "deleted": false}, 200)
	restored, _ := store.Get[domain.Publication](a.Store.DB, "publications", old.ID)
	if restored.DeletedAt != "" || restored.Body != old.Body {
		t.Fatal("old publication could not be restored intact")
	}
}

func TestPublicationReplacementRollsBackOnWriteFailure(t *testing.T) {
	a, _, old, review := replacementFixture(t)
	_, err := a.Store.DB.Exec(`CREATE TRIGGER fail_replacement BEFORE INSERT ON publications WHEN NEW.id != '` + old.ID + `' BEGIN SELECT RAISE(ABORT, 'test write failure'); END;`)
	if err != nil {
		t.Fatal(err)
	}
	request(t, a, "POST", "/publications/"+review.ID+"/confirm", preparedTestInput(review), 500)
	saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", old.ID)
	all, _ := store.List[domain.Publication](a.Store.DB, "publications")
	if saved.DeletedAt != "" || saved.Body != old.Body || len(all) != 1 {
		t.Fatal("failed confirmation did not roll back archive")
	}
}

func TestPublicationReplacementBlocksActiveOrUnverifiedOldDrafts(t *testing.T) {
	for _, scenario := range []string{"qr", "job", "needs_review", "duplicate-qr"} {
		t.Run(scenario, func(t *testing.T) {
			a, _, old, review := replacementFixture(t)
			if scenario == "qr" || scenario == "duplicate-qr" {
				id := old.ID
				if scenario == "duplicate-qr" {
					duplicate := old
					duplicate.ID = ID()
					duplicate.WorkflowManaged = false
					store.Put(a.Store.DB, "publications", duplicate.ID, duplicate)
					id = duplicate.ID
				}
				store.Put(a.Store.DB, "mobile_handoffs", id, mobileHandoffRecord{Session: miniappCloudSession{State: "created", ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}})
			} else if scenario == "job" {
				job := newJob("publish", old.ID, nil)
				store.Put(a.Store.DB, "jobs", job.ID, job)
			} else {
				old.OnlineState = "needs_review"
				store.Put(a.Store.DB, "publications", old.ID, old)
			}
			request(t, a, "POST", "/publications/"+review.ID+"/confirm", preparedTestInput(review), 409)
			saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", old.ID)
			if saved.DeletedAt != "" {
				t.Fatal("blocked confirmation archived old draft")
			}
		})
	}
}

func TestPublicationRestoreBatchCannotCreateDuplicateCurrentDrafts(t *testing.T) {
	a := testApp(t)
	p := publishFixture(t, a)
	p.DeletedAt = Now()
	store.Put(a.Store.DB, "publications", p.ID, p)
	other := p
	other.ID = ID()
	store.Put(a.Store.DB, "publications", other.ID, other)
	request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID, other.ID}, "deleted": false}, 409)
	for _, id := range []string{p.ID, other.ID} {
		v, _ := store.Get[domain.Publication](a.Store.DB, "publications", id)
		if v.DeletedAt == "" {
			t.Fatal("batch restore partially committed")
		}
	}
}
