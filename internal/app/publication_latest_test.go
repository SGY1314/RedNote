package app

import (
	"slices"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func preparedTestInput(p domain.Publication) publicationConfirmation {
	return publicationConfirmation{ID: p.ID, Revision: p.Revision, PreparedVersionID: p.VersionID, TargetPlatform: p.TargetPlatform}
}
func confirmPreparedTest(t *testing.T, a *App, p domain.Publication) domain.Publication {
	t.Helper()
	return decode[domain.Publication](t, request(t, a, "POST", "/publications/"+p.ID+"/confirm", preparedTestInput(p), 200))
}
func TestLatestPublicationCombinesSavedStagesAndRequiresReview(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	endpoint := "/rewrites/" + p.ID + "/workflow/stage"
	save := func(input workflowStageRequest, status int) stageReply {
		return decode[stageReply](t, request(t, a, "POST", endpoint, input, status))
	}
	first := save(workflowStageRequest{Step: "title", Text: "手冲咖啡新标题"}, 201)
	if len(first.Publications) != 0 {
		t.Fatal("confirmation created publications")
	}
	preview := save(workflowStageRequest{Step: "title", Text: first.Version.Title, Publish: true}, 200)
	pubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
	if len(pubs) != 0 {
		t.Fatal("preview persisted a publication")
	}
	ready := confirmPreparedTest(t, a, preview.Publications[0])
	if !ready.Ready || ready.ConfirmedAt == "" {
		t.Fatal("final confirmation missing")
	}
	copy := save(workflowStageRequest{Step: "copy", Text: "新保存的完整正文", Topics: []string{"新话题"}, TitleKey: first.Workflow.Title.Key}, 201)
	unchanged, _ := store.Get[domain.Publication](a.Store.DB, "publications", ready.ID)
	if unchanged.Body != source.Body || !unchanged.Ready {
		t.Fatal("ordinary confirmation changed publication")
	}
	review := save(workflowStageRequest{Step: "copy", Text: copy.Version.Body, Topics: copy.Version.Topics, TitleKey: copy.Workflow.Title.Key, Publish: true}, 200)
	unchanged, _ = store.Get[domain.Publication](a.Store.DB, "publications", ready.ID)
	if unchanged.Body != source.Body || !unchanged.Ready {
		t.Fatal("cancellable preview changed publication")
	}
	latest := confirmPreparedTest(t, a, review.Publications[0])
	if latest.ID == ready.ID || latest.Body != copy.Version.Body {
		t.Fatal("final confirmation did not replace the unpublished draft")
	}
	pubs, _ = store.List[domain.Publication](a.Store.DB, "publications")
	if len(pubs) != 2 {
		t.Fatal("old snapshot not preserved in trash")
	}
	archived, _ := store.Get[domain.Publication](a.Store.DB, "publications", ready.ID)
	if archived.DeletedAt == "" || archived.Body != source.Body {
		t.Fatal("old publication was not archived intact")
	}
	old, _ := store.Get[domain.Version](a.Store.DB, "versions", first.Version.ID)
	if old.Body != source.Body {
		t.Fatal("history changed")
	}
	request(t, a, "POST", "/publications/"+latest.ID+"/status", map[string]any{"status": "pending", "revision": latest.Revision}, 400)
	marked := decode[domain.Publication](t, request(t, a, "POST", "/publications/"+latest.ID+"/status", map[string]any{"status": "published", "revision": latest.Revision}, 200))
	if marked.ManualStatus != "published" {
		t.Fatal("manual status missing")
	}
	request(t, a, "POST", "/publications/"+latest.ID+"/status", map[string]any{"status": "ready", "revision": latest.Revision}, 409)
	marked.RemoteWorkID, marked.PublishedAt = "receipt", Now()
	store.Put(a.Store.DB, "publications", marked.ID, marked)
	reset := decode[domain.Publication](t, request(t, a, "POST", "/publications/"+latest.ID+"/status", map[string]any{"status": "ready", "revision": marked.Revision}, 200))
	if reset.ManualStatus != "ready" || reset.RemoteWorkID != "receipt" || reset.PublishedAt != marked.PublishedAt {
		t.Fatal("manual status erased remote evidence")
	}
	// Preparing the same version after publication must allocate a new record.
	next := save(workflowStageRequest{Step: "copy", Text: copy.Version.Body, Topics: copy.Version.Topics, TitleKey: copy.Workflow.Title.Key, Publish: true}, 200)
	if next.Publications[0].ID == reset.ID {
		t.Fatal("preview reused published record ID")
	}
	nextReady := confirmPreparedTest(t, a, next.Publications[0])
	if nextReady.ID == reset.ID {
		t.Fatal("final confirmation overwrote published record")
	}
	preserved, _ := store.Get[domain.Publication](a.Store.DB, "publications", reset.ID)
	if preserved.RemoteWorkID != "receipt" || preserved.PublishedAt != reset.PublishedAt {
		t.Fatal("published receipt was overwritten")
	}
}

func TestPublicationConfirmationIsAtomicAndRejectsMissingMedia(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", workflowStageRequest{Step: "title", Text: "双平台咖啡标题", Publish: true, TargetPlatform: "both"}, 201))
	if len(reply.Publications) != 2 {
		t.Fatal("missing platform draft")
	}
	entries := []publicationConfirmation{preparedTestInput(reply.Publications[0]), preparedTestInput(reply.Publications[1])}
	entries[1].Revision = 0
	request(t, a, "POST", "/publications/confirm", map[string]any{"items": entries}, 409)
	pubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
	if len(pubs) != 0 {
		t.Fatal("partial confirmation escaped transaction")
	}
	entries[1].Revision = 1
	request(t, a, "POST", "/publications/confirm", map[string]any{"items": entries}, 200)
	first, _ := store.Get[domain.Publication](a.Store.DB, "publications", entries[0].ID)
	// Moving a required material to trash prevents re-confirming a draft.
	asset, _ := store.Get[domain.Asset](a.Store.DB, "assets", first.AssetIDs[0])
	asset.DeletedAt = Now()
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	request(t, a, "POST", "/publications/"+first.ID+"/confirm", map[string]any{"revision": 1}, 400)
}

func TestPublicationConfirmationEditsPreserveSourcesAndHistory(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", workflowStageRequest{Step: "title", Text: "编辑前的标题", Publish: true}, 201))
	pub := reply.Publications[0]
	edit := &publicationEdits{Title: "编辑后的标题", Body: "修改后的发布正文", Topics: []string{"新话题"}, AssetIDs: []string{pub.AssetIDs[1]}}
	updated := decode[domain.Publication](t, request(t, a, "POST", "/publications/"+pub.ID+"/confirm", func() publicationConfirmation { v := preparedTestInput(pub); v.Edit = edit; return v }(), 200))
	if updated.Title != edit.Title || updated.Body != edit.Body || !slices.Equal(updated.Topics, edit.Topics) || !slices.Equal(updated.AssetIDs, edit.AssetIDs) || updated.CoverID != edit.AssetIDs[0] || updated.Revision != pub.Revision+1 || !updated.Ready {
		t.Fatal("edited confirmation did not persist", updated)
	}
	if _, _, err := a.mobilePublishSnapshot(updated); err != nil {
		t.Fatal("edited publication cannot generate mobile handoff", err)
	}
	old, _ := store.Get[domain.Version](a.Store.DB, "versions", reply.Version.ID)
	original, _ := store.Get[domain.Revision](a.Store.DB, "revisions", source.ID)
	removed, _ := store.Get[domain.Asset](a.Store.DB, "assets", pub.AssetIDs[0])
	if old.Title != reply.Version.Title || !slices.Equal(old.Media.AssetIDs, pub.AssetIDs) || original.Body != source.Body || removed.DeletedAt != "" {
		t.Fatal("draft edit modified history or source assets")
	}
	request(t, a, "POST", "/publications/"+pub.ID+"/confirm", publicationConfirmation{Revision: pub.Revision, Edit: edit}, 409)
	unrelated := sampleImage(t, a)
	invalid := *edit
	invalid.AssetIDs = []string{unrelated.ID}
	request(t, a, "POST", "/publications/"+pub.ID+"/confirm", publicationConfirmation{Revision: updated.Revision, Edit: &invalid}, 400)
	invalid.AssetIDs = []string{}
	request(t, a, "POST", "/publications/"+pub.ID+"/confirm", publicationConfirmation{Revision: updated.Revision, Edit: &invalid}, 400)
	invalid.AssetIDs = []string{edit.AssetIDs[0], edit.AssetIDs[0]}
	request(t, a, "POST", "/publications/"+pub.ID+"/confirm", publicationConfirmation{Revision: updated.Revision, Edit: &invalid}, 400)
	updated.OnlineState = "submitting"
	store.Put(a.Store.DB, "publications", updated.ID, updated)
	invalid = *edit
	invalid.Body = "不应提交的正文"
	request(t, a, "POST", "/publications/"+pub.ID+"/confirm", publicationConfirmation{Revision: updated.Revision, Edit: &invalid}, 409)
	updated.OnlineState, updated.PublishedAt = "published", Now()
	store.Put(a.Store.DB, "publications", updated.ID, updated)
	request(t, a, "POST", "/publications/"+pub.ID+"/confirm", publicationConfirmation{Revision: updated.Revision, Edit: &invalid}, 409)
}
func TestPublicationEditsConfirmAtomically(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", workflowStageRequest{Step: "title", Text: "多平台编辑测试", Publish: true, TargetPlatform: "both"}, 201))
	first, second := reply.Publications[0], reply.Publications[1]
	edit := &publicationEdits{Title: "编辑后的发布稿", Body: "新正文", Topics: []string{}, AssetIDs: first.AssetIDs}
	badEdit := *edit
	badEdit.AssetIDs = []string{}
	entries := []publicationConfirmation{preparedTestInput(first), preparedTestInput(second)}
	entries[0].Edit = edit
	entries[1].Edit = &badEdit
	request(t, a, "POST", "/publications/confirm", map[string]any{"items": entries}, 400)
	savedPubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
	if len(savedPubs) != 0 {
		t.Fatal("failed batch partially saved edits")
	}
	entries[1].Edit = edit
	request(t, a, "POST", "/publications/confirm", map[string]any{"items": entries}, 200)
	for _, id := range []string{first.ID, second.ID} {
		saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", id)
		if saved.Body != edit.Body || !saved.Ready {
			t.Fatal("batch edits missing")
		}
	}
}
