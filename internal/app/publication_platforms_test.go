package app

import (
	"reflect"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func ensurePlatformTest(t *testing.T, a *App, p domain.Publication, platform string, status int) domain.Publication {
	t.Helper()
	return decode[domain.Publication](t, request(t, a, "POST", "/publications/"+p.ID+"/platform", map[string]any{"platform": platform, "revision": p.Revision}, status))
}

func TestSharedDraftPlatformRetryAndIndependentStatus(t *testing.T) {
	for _, sourcePlatform := range []string{"xhs", "douyin"} {
		t.Run(sourcePlatform, func(t *testing.T) {
			a := testApp(t)
			v := confirmedMultiPlatformVersion(t, a)
			p := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]string{"version_id": v.ID, "target_platform": sourcePlatform, "request_id": "source-request"}, 201))
			p.ManualStatus, p.RemoteWorkID, p.PublishedURL, p.PublishedAt = "published", "receipt", "https://example.test/work", Now()
			store.Put(a.Store.DB, "publications", p.ID, p)
			target := "douyin"
			if sourcePlatform == "douyin" {
				target = "xhs"
			}
			other := ensurePlatformTest(t, a, p, target, 201)
			if other.ID == p.ID || other.SharedDraftID != p.ID || other.VersionID != p.VersionID || !reflect.DeepEqual(other.Content, p.Content) || !reflect.DeepEqual(other.AssetIDs, p.AssetIDs) || other.CoverID != p.CoverID {
				t.Fatal("platform copy did not preserve the shared snapshot")
			}
			if publicationPublished(other) || other.OnlineJobID != "" || other.PublishedURL != "" || other.CreationID != "" {
				t.Fatal("copied another platform's receipt or request identity")
			}
			retry := ensurePlatformTest(t, a, p, target, 200)
			if !reflect.DeepEqual(other, retry) {
				t.Fatal("retry duplicated or reset the counterpart")
			}
			marked := decode[domain.Publication](t, request(t, a, "POST", "/publications/"+other.ID+"/status", map[string]any{"status": "published", "revision": other.Revision}, 200))
			request(t, a, "POST", "/publications/"+other.ID+"/status", map[string]any{"status": "ready", "revision": marked.Revision}, 200)
			after, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
			if !reflect.DeepEqual(p, after) {
				t.Fatal("other platform status changed source receipt")
			}
			// Retrying the original creation request must still return its original result.
			request(t, a, "POST", "/publications", map[string]string{"version_id": v.ID, "target_platform": sourcePlatform, "request_id": "source-request"}, 200)
			request(t, a, "POST", "/publications/"+p.ID+"/platform", map[string]any{"platform": target, "revision": p.Revision + 1}, 409)
			request(t, a, "POST", "/publications/"+p.ID+"/platform", map[string]any{"platform": "bad", "revision": p.Revision}, 400)
			request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{p.ID}, "deleted": true}, 200)
			for _, id := range []string{p.ID, other.ID} {
				saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", id)
				if saved.DeletedAt == "" {
					t.Fatal("partial group trash")
				}
			}
			request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{other.ID}, "deleted": false}, 200)
			for _, id := range []string{p.ID, other.ID} {
				saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", id)
				if saved.DeletedAt != "" {
					t.Fatal("partial group restore")
				}
			}
			request(t, a, "POST", "/publications/batch-trash", map[string]any{"ids": []string{other.ID}, "deleted": true}, 200)
			request(t, a, "POST", "/publications/batch-purge", map[string]any{"ids": []string{p.ID}, "confirm": true}, 200)
			remaining, _ := store.List[domain.Publication](a.Store.DB, "publications")
			if len(remaining) != 0 {
				t.Fatal("permanent deletion left an orphan platform record")
			}
		})
	}
}

func TestSharedDraftReplacementAndPublishedHistory(t *testing.T) {
	for _, publishedPlatform := range []string{"", "xhs", "douyin"} {
		t.Run("published-"+publishedPlatform, func(t *testing.T) {
			a, project, old, review := replacementFixture(t)
			other := ensurePlatformTest(t, a, old, "douyin", 201)
			if publishedPlatform != "" {
				id := old.ID
				if publishedPlatform == "douyin" {
					id = other.ID
				}
				saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", id)
				saved.ManualStatus = "published"
				store.Put(a.Store.DB, "publications", id, saved)
			}
			v, _ := store.Get[domain.Version](a.Store.DB, "versions", review.VersionID)
			proposals, err := a.latestWorkflowPublications(project, v, "xhs")
			if err != nil {
				t.Fatal(err)
			}
			latest := confirmPreparedTest(t, a, proposals[0])
			if latest.ID == old.ID {
				t.Fatal("reused old frozen draft")
			}
			all, _ := store.List[domain.Publication](a.Store.DB, "publications")
			for _, id := range []string{old.ID, other.ID} {
				saved, _ := store.Get[domain.Publication](a.Store.DB, "publications", id)
				if publishedPlatform == "" {
					if saved.DeletedAt == "" {
						t.Fatal("pending companion not archived with old content")
					}
				} else if saved.DeletedAt != "" || publicationReplaced(saved, all) {
					t.Fatal("published history or its pending platform became inaccessible")
				}
			}
		})
	}
}

func TestSharedDraftRejectsChangedOrDeletedMaterial(t *testing.T) {
	a := testApp(t)
	v := confirmedMultiPlatformVersion(t, a)
	p := decode[domain.Publication](t, request(t, a, "POST", "/publications", map[string]string{"version_id": v.ID}, 201))
	asset, _ := store.Get[domain.Asset](a.Store.DB, "assets", p.AssetIDs[0])
	asset.DeletedAt = Now()
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	request(t, a, "POST", "/publications/"+p.ID+"/platform", map[string]any{"platform": "douyin", "revision": p.Revision}, 400)
	asset.DeletedAt = ""
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	p.Body = "unconfirmed edit"
	store.Put(a.Store.DB, "publications", p.ID, p)
	request(t, a, "POST", "/publications/"+p.ID+"/platform", map[string]any{"platform": "douyin", "revision": p.Revision}, 409)
	all, _ := store.List[domain.Publication](a.Store.DB, "publications")
	if len(all) != 1 {
		t.Fatal("invalid draft left a partial platform record")
	}
}

func TestSharedDraftDouyinContentCanCreateXHSImageAndVideoQR(t *testing.T) {
	for _, kind := range []string{"image", "video"} {
		t.Run(kind, func(t *testing.T) {
			var a *App
			var p domain.Publication
			if kind == "video" {
				a, p = mobileVideoFixture(t)
			} else {
				a, p, _, _ = mobileFixture(t)
			}
			store.Put(a.Store.DB, "projects", p.ProjectID, domain.Project{ID: p.ProjectID, Platform: "douyin", Name: "双平台稿件"})
			p.TargetPlatform, p.ManualStatus = "douyin", "published"
			store.Put(a.Store.DB, "publications", p.ID, p)
			xhs := ensurePlatformTest(t, a, p, "xhs", 201)
			if !mobilePublicationEligible(xhs) {
				t.Fatal("XHS counterpart inherited Douyin publication restrictions")
			}
			created := decode[miniappCloudSession](t, request(t, a, "POST", "/publications/"+xhs.ID+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("q", 32)}, 201))
			if created.State != "created" {
				t.Fatal("QR relay session was not created")
			}
			after, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
			if !reflect.DeepEqual(after, p) {
				t.Fatal("XHS QR mutated the Douyin receipt")
			}
		})
	}
}
