package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestWorkflowReferenceListsAreArraysWithoutSourceOrTopics(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]any{"name": "空白项目"}, 201))
	for _, withSource := range []bool{false, true} {
		if withSource {
			rev := domain.Revision{ID: ID(), Body: "没有标签的正文"}
			if err := store.Put(a.Store.DB, "revisions", rev.ID, rev); err != nil {
				t.Fatal(err)
			}
			p.RevisionID = rev.ID
			if err := store.Put(a.Store.DB, "projects", p.ID, p); err != nil {
				t.Fatal(err)
			}
		}
		response := decode[map[string]any](t, request(t, a, "GET", "/rewrites/"+p.ID+"/workflow", nil, 200))
		reference := response["reference"].(map[string]any)
		for _, key := range []string{"topics", "asset_ids"} {
			if list, ok := reference[key].([]any); !ok || len(list) != 0 {
				t.Fatalf("%s must serialize as an empty array (source=%v): %#v", key, withSource, reference[key])
			}
		}
		if withSource && reference["body"] != "没有标签的正文" {
			t.Fatal("normalizing empty lists changed the source body")
		}
	}
}

func TestNullModelCatalogRespondsWithEmptyArray(t *testing.T) {
	a := testApp(t)
	for _, capability := range modelCapabilities {
		if err := store.Put(a.Store.DB, "settings", modelsSettingsKey(capability), []rewriteModel(nil)); err != nil {
			t.Fatal(err)
		}
		response := decode[any](t, request(t, a, "GET", "/"+capability+"-models", nil, 200))
		if list, ok := response.([]any); !ok || len(list) != 0 {
			t.Fatalf("%s catalog must be [], got %#v", capability, response)
		}
	}
}
