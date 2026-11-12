package app

import (
	"encoding/json"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestResultLibraryAdditionRequiresExplicitDraftAndAvailableFile(t *testing.T) {
	for _, kind := range []string{"image", "video"} {
		t.Run(kind, func(t *testing.T) {
			a, p, _ := stageSourceFixture(t)
			asset := sampleImage(t, a)
			if kind == "video" {
				asset = nativeVideoFixture(t, a, p)
			}
			asset.ID, asset.ProjectID, asset.RevisionID = ID(), "another-project", ""
			asset.Source, asset.LibraryState = "upload", "saved"
			if err := store.Put(a.Store.DB, "assets", asset.ID, asset); err != nil {
				t.Fatal(err)
			}
			media := &domain.VersionMedia{Kind: kind, AssetIDs: []string{asset.ID}}
			if err := a.validateProjectMediaResults(p, media, kind); err == nil {
				t.Fatal("library media accepted without explicit addition")
			}
			w, _ := a.readWorkflow(p.ID)
			raw, _ := json.Marshal(map[string]any{"result_asset_ids": []string{asset.ID}})
			w.Drafts[kind] = workflowDraft{Revision: 1, Data: raw}
			if err := store.Put(a.Store.DB, "creation_workflows", p.ID, w); err != nil {
				t.Fatal(err)
			}
			if err := a.validateProjectMediaResults(p, media, kind); err != nil {
				t.Fatal("added library media rejected", err)
			}
			basis, err := a.readWorkflowBasis(p, w)
			if err != nil {
				t.Fatal(err)
			}
			reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", map[string]any{
				"step": kind, "title_key": basis.Title.Key, "copy_key": basis.Copy.Key, "media": media,
				"use_project_image_results": kind == "image", "use_project_video_results": kind == "video",
			}, 201))
			if len(reply.Version.Media.AssetIDs) != 1 || reply.Version.Media.AssetIDs[0] != asset.ID {
				t.Fatal("library selection not saved")
			}
			for _, state := range []string{"result", "collected"} {
				asset.LibraryState = state
				store.Put(a.Store.DB, "assets", asset.ID, asset)
				if err := a.validateProjectMediaResults(p, media, kind); err == nil {
					t.Fatal("unsaved media accepted", state)
				}
			}
			asset.LibraryState, asset.Path = "saved", "missing-library-file"
			store.Put(a.Store.DB, "assets", asset.ID, asset)
			if err := a.validateProjectMediaResults(p, media, kind); err == nil {
				t.Fatal("missing library file accepted")
			}
		})
	}
}

func TestImageTimelineSelectionPreservesOwnershipAndFileChecks(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	image := sampleImage(t, a)
	image.Source, image.ProjectID = "generated", p.ID
	store.Put(a.Store.DB, "assets", image.ID, image)
	media := &domain.VersionMedia{Kind: "image", AssetIDs: []string{image.ID}, CoverID: image.ID}
	if err := a.validateProjectImageResults(p, media); err != nil {
		t.Fatal("saved result without task history must remain selectable", err)
	}
	for _, test := range []struct {
		name   string
		mutate func(*domain.Asset)
	}{
		{"foreign project", func(asset *domain.Asset) { asset.ProjectID = "another-project" }},
		{"deleted", func(asset *domain.Asset) { asset.DeletedAt = Now() }},
		{"not downloaded", func(asset *domain.Asset) { asset.Status = "pending" }},
		{"wrong kind", func(asset *domain.Asset) { asset.Kind = "video" }},
		{"missing file", func(asset *domain.Asset) { asset.Path = "missing-result.png" }},
		{"unrelated upload", func(asset *domain.Asset) { asset.ProjectID = ""; asset.Source = "upload" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			copy := image
			test.mutate(&copy)
			store.Put(a.Store.DB, "assets", copy.ID, copy)
			if err := a.validateProjectImageResults(p, media); err == nil {
				t.Fatal("invalid result was accepted")
			}
		})
	}
	store.Put(a.Store.DB, "assets", image.ID, image)
	media.AssetIDs = append(media.AssetIDs, image.ID)
	if err := a.validateProjectImageResults(p, media); err == nil {
		t.Fatal("duplicate results accepted")
	}
	media.AssetIDs = []string{image.ID}
	media.CoverID = "foreign-cover"
	if err := a.validateProjectImageResults(p, media); err == nil {
		t.Fatal("unselected cover accepted")
	}
}

func TestImageTimelineOriginalCanBeSavedAndPublished(t *testing.T) {
	a, p, source := stageSourceFixture(t)
	id := source.AssetIDs[0]
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	basis, err := a.readWorkflowBasis(p, w)
	if err != nil {
		t.Fatal(err)
	}
	reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", map[string]any{
		"step": "image", "use_project_image_results": true,
		"title_key": basis.Title.Key, "copy_key": basis.Copy.Key,
		"media":   domain.VersionMedia{Kind: "image", AssetIDs: []string{id}, CoverID: id},
		"publish": true,
	}, 201))
	if reply.Version.Media.AssetIDs[0] != id || len(reply.Publications) != 1 || reply.Publications[0].AssetIDs[0] != id {
		t.Fatal("original image missing from saved publication")
	}
	other := p
	other.RevisionID = ""
	if err := a.validateProjectImageResults(other, &domain.VersionMedia{Kind: "image", AssetIDs: []string{id}}); err == nil {
		t.Fatal("unrelated original image accepted")
	}
}

func TestVideoCarouselSavesOriginalUploadedAndGenerated(t *testing.T) {
	a, p, _ := stageSourceFixture(t)
	original := nativeVideoFixture(t, a, p)
	w, err := a.readWorkflow(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	basis, err := a.readWorkflowBasis(p, w)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"collection", "upload", "generated"} {
		video := original
		if source != "collection" {
			video.ID, video.RevisionID, video.ProjectID, video.Source = ID(), "", p.ID, source
			if err = store.Put(a.Store.DB, "assets", video.ID, video); err != nil {
				t.Fatal(err)
			}
		}
		reply := decode[stageReply](t, request(t, a, "POST", "/rewrites/"+p.ID+"/workflow/stage", map[string]any{
			"step": "video", "use_project_video_results": true, "title_key": basis.Title.Key, "copy_key": basis.Copy.Key,
			"media": domain.VersionMedia{Kind: "video", AssetIDs: []string{video.ID}}, "publish": true,
		}, 201))
		if reply.Version.Media.AssetIDs[0] != video.ID || len(reply.Publications) != 1 || reply.Publications[0].AssetIDs[0] != video.ID {
			t.Fatal("video selection lost", source)
		}
		if source != "collection" {
			other := p
			other.ID = "other-project"
			if err = a.validateProjectVideoResults(other, &domain.VersionMedia{Kind: "video", AssetIDs: []string{video.ID}}); err == nil {
				t.Fatal("foreign video accepted")
			}
		}
	}
	if err = a.validateProjectVideoResults(p, &domain.VersionMedia{Kind: "video", AssetIDs: []string{original.ID, original.ID}}); err == nil {
		t.Fatal("multiple video selection accepted")
	}
}
