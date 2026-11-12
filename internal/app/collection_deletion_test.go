package app

import (
	"bytes"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestDeleteRestoreCollectionPreservesReferencedData(t *testing.T) {
	a := testApp(t)
	media := sampleImage(t, a)
	n := domain.Note{ID: ID(), Platform: "xhs", NoteID: "abc123", URL: "https://www.xiaohongshu.com/explore/abc123", Title: "参考", RevisionID: ID(), CreatedAt: Now(), UpdatedAt: Now()}
	revision := domain.Revision{ID: n.RevisionID, NoteID: n.ID, Title: "原始参考", Body: "保留的来源", AssetIDs: []string{media.ID}}
	if err := store.Put(a.Store.DB, "notes", n.ID, n); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(a.Store.DB, "revisions", revision.ID, revision); err != nil {
		t.Fatal(err)
	}
	project := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"note_id": n.ID}, 201))
	request(t, a, "PATCH", "/rewrites/"+project.ID, map[string]any{"kind": "image", "asset_ids": []string{media.ID}}, 200)
	version := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+project.ID+"/versions", map[string]any{"title": "自己的文稿", "body": "自己的内容"}, 201))
	request(t, a, "POST", "/rewrites/"+project.ID+"/versions/"+version.ID+"/confirm", map[string]any{}, 200)
	publication := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]any{"version_id": version.ID, "kind": "image", "asset_ids": []string{media.ID}}, 201))
	beforeProject := request(t, a, "GET", "/rewrites/"+project.ID, nil, 200)
	beforePub, _ := store.Get[domain.Publication](a.Store.DB, "publications", publication.ID)
	request(t, a, "DELETE", "/collections/"+n.ID, nil, 200)
	list := decode[struct{ Total int }](t, request(t, a, "GET", "/collections", nil, 200))
	if list.Total != 0 {
		t.Fatal("deleted note still visible")
	}
	trash := decode[struct {
		Items []domain.Note
		Total int
	}](t, request(t, a, "GET", "/collections?deleted=true", nil, 200))
	if trash.Total != 1 || trash.Items[0].DeletedAt == "" {
		t.Fatal("missing recycle entry")
	}
	if !bytes.Equal(beforeProject, request(t, a, "GET", "/rewrites/"+project.ID, nil, 200)) {
		t.Fatal("rewrite changed")
	}
	afterPub, _ := store.Get[domain.Publication](a.Store.DB, "publications", publication.ID)
	if jsonString(beforePub) != jsonString(afterPub) {
		t.Fatal("publication snapshot changed")
	}
	request(t, a, "GET", "/assets/"+media.ID+"/file", nil, 200)
	request(t, a, "GET", "/collections/"+n.ID, nil, 200)
	duplicate := request(t, a, "POST", "/collections", map[string]string{"text": n.URL}, 202)
	if !bytes.Contains(duplicate, []byte(`"deleted":true`)) {
		t.Fatal("deleted duplicate not identified")
	}
	request(t, a, "POST", "/collections/"+n.ID+"/restore", map[string]any{}, 200)
	restored := decode[struct {
		Items []domain.Note
		Total int
	}](t, request(t, a, "GET", "/collections", nil, 200))
	if restored.Total != 1 || restored.Items[0].ID != n.ID || restored.Items[0].RevisionID != revision.ID {
		t.Fatal("restore lost original identity")
	}
}

func TestBatchDeletionAtomicAndIdempotent(t *testing.T) {
	a := testApp(t)
	ids := []string{ID(), ID()}
	for _, id := range ids {
		if err := store.Put(a.Store.DB, "notes", id, domain.Note{ID: id, Platform: "xhs", NoteID: id}); err != nil {
			t.Fatal(err)
		}
	}
	request(t, a, "POST", "/collections/batch-delete", map[string]any{"ids": []string{ids[0], "missing"}}, 404)
	first, _ := store.Get[domain.Note](a.Store.DB, "notes", ids[0])
	if first.DeletedAt != "" {
		t.Fatal("batch partially applied on invalid ID")
	}
	request(t, a, "POST", "/collections/batch-delete", map[string]any{"ids": []string{}}, 400)
	for i := 0; i < 2; i++ {
		request(t, a, "POST", "/collections/batch-delete", map[string]any{"ids": append(ids, ids[0])}, 200)
	}
	active := decode[struct{ Total int }](t, request(t, a, "GET", "/collections", nil, 200))
	if active.Total != 0 {
		t.Fatal("batch did not delete all")
	}
	request(t, a, "POST", "/collections/batch-restore", map[string]any{"ids": ids}, 200)
	active = decode[struct{ Total int }](t, request(t, a, "GET", "/collections", nil, 200))
	if active.Total != 2 {
		t.Fatal("batch restore failed")
	}
}
