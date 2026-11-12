package app

import (
	"reflect"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestDeleteCollectionTagPreservesContentAndOtherMetadata(t *testing.T) {
	a := testApp(t)
	first, _ := collectMediaFixture(t, a, "xhs", "tag-first")
	second, _ := collectMediaFixture(t, a, "xhs", "tag-second")
	for _, id := range []string{first, second} {
		request(t, a, "PATCH", "/collections/"+id, map[string]any{"rating": 4, "tags": []string{"666", "旅行"}}, 200)
	}
	note, _ := store.Get[domain.Note](a.Store.DB, "notes", second)
	note.DeletedAt = Now()
	store.Put(a.Store.DB, "notes", second, note)
	before, _ := store.Get[domain.Revision](a.Store.DB, "revisions", note.RevisionID)
	request(t, a, "POST", "/collections/tags/delete", map[string]any{"tag": " "}, 400)
	result := decode[struct{ Count int }](t, request(t, a, "POST", "/collections/tags/delete", map[string]any{"tag": "666"}, 200))
	if result.Count != 2 {
		t.Fatal("tag must be removed from active and recycled notes", result)
	}
	for _, id := range []string{first, second} {
		n, _ := store.Get[domain.Note](a.Store.DB, "notes", id)
		if n.Rating != 4 || !reflect.DeepEqual(n.Tags, []string{"旅行"}) {
			t.Fatal("unrelated metadata changed", n)
		}
	}
	after, _ := store.Get[domain.Revision](a.Store.DB, "revisions", note.RevisionID)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("original content changed")
	}
	result = decode[struct{ Count int }](t, request(t, a, "POST", "/collections/tags/delete", map[string]any{"tag": "666"}, 200))
	if result.Count != 0 {
		t.Fatal("repeated deletion must be safe")
	}
}
