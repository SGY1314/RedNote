package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestRewriteWorkflowGeneratedAndDeduplicatedVersions(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "版本流程"}, 201))
	image := sampleImage(t, a)
	media := &domain.VersionMedia{Kind: "image", AssetIDs: []string{image.ID}}
	trial := domain.Version{ID: ID(), ProjectID: p.ID, Generated: true, Content: domain.Content{Title: "试写", Body: "正文"}, Media: media, Status: "draft"}
	if err := a.persistVersion(&trial); err != nil {
		t.Fatal(err)
	}
	if trial.Number != 0 {
		t.Fatal("trial consumed version number")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+trial.ID+"/confirm", nil, 409)
	body := map[string]any{"title": "试写", "body": "正文", "media": media, "parent_id": trial.ID, "name": "温柔版"}
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", body, 201))
	if v.Number != 1 || v.Generated {
		t.Fatal(v)
	}
	duplicate := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", body, 200))
	if duplicate.ID != v.ID {
		t.Fatal("duplicate version created")
	}
	body["creative"] = &domain.CreativeSettings{}
	duplicate = decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", body, 200))
	if duplicate.ID != v.ID {
		t.Fatal("empty creative settings duplicated content")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", nil, 200)
	pub := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]any{"version_id": v.ID}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/name", map[string]string{"name": "最终版"}, 200)
	body["body"] = "修改正文"
	next := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", body, 201))
	if next.Number != 2 {
		t.Fatal(next)
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+next.ID+"/confirm", nil, 200)
	project, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	if project.SelectedVersions["image"] != next.ID {
		t.Fatal("selection missing")
	}
	original, _ := store.Get[domain.Version](a.Store.DB, "versions", v.ID)
	if original.Status != "confirmed" || original.Body != "正文" || original.Name != "最终版" {
		t.Fatal("old version changed", original)
	}
	frozen, _ := store.Get[domain.Publication](a.Store.DB, "publications", pub.ID)
	if frozen.Body != "正文" {
		t.Fatal("publication snapshot changed")
	}
}

func TestRewriteWorkflowIncompleteConfirmationAndDraftCAS(t *testing.T) {
	a := testApp(t)
	p := decode[domain.Project](t, request(t, a, "POST", "/rewrites", map[string]string{"name": "草稿"}, 201))
	v := decode[domain.Version](t, request(t, a, "POST", "/rewrites/"+p.ID+"/versions", map[string]string{"title": "标题", "body": "正文"}, 201))
	request(t, a, "POST", "/rewrites/"+p.ID+"/versions/"+v.ID+"/confirm", nil, 400)
	draft := domain.RewriteDraft{Content: domain.Content{Body: "尚未填写标题"}, VersionID: v.ID, Media: &domain.VersionMedia{Kind: "image"}, Requirements: "保留我的要求", Length: "简短一些"}
	url := "/rewrites/" + p.ID + "/drafts/image"
	saved := decode[domain.RewriteDraft](t, request(t, a, "POST", url, draft, 200))
	if saved.Revision != 1 || saved.SavedAt == "" {
		t.Fatal(saved)
	}
	request(t, a, "POST", url, draft, 409)
	saved.Content.Body = "最新草稿"
	saved = decode[domain.RewriteDraft](t, request(t, a, "POST", url, saved, 200))
	if saved.Revision != 2 {
		t.Fatal(saved)
	}
	project, _ := store.Get[domain.Project](a.Store.DB, "projects", p.ID)
	if project.Drafts["image"].Content.Body != "最新草稿" || project.Drafts["image"].Length != "简短一些" {
		t.Fatal("draft lost")
	}
	request(t, a, "POST", "/rewrites/"+p.ID+"/drafts/video", saved, 400)
	saved.VersionID = "another-project-version"
	request(t, a, "POST", url, saved, 400)
}
