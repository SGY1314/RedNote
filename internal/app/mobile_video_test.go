package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/handoffcloud"
	"xhs-workbench/internal/store"
)

func mobileVideoFixture(t *testing.T) (*App, domain.Publication) {
	a, p, _, _ := mobileFixture(t)
	video := nativeVideoFixture(t, a, domain.Project{ID: p.ProjectID})
	p.Kind, p.AssetIDs = "video", []string{video.ID}
	v, err := store.Get[domain.Version](a.Store.DB, "versions", p.VersionID)
	if err != nil {
		t.Fatal(err)
	}
	v.Media.Kind, v.Media.AssetIDs = p.Kind, p.AssetIDs
	if err := store.Put(a.Store.DB, "versions", v.ID, v); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(a.Store.DB, "publications", p.ID, p); err != nil {
		t.Fatal(err)
	}
	return a, p
}

func TestMobileVideoHandoffUploadsFrozenMP4WithoutCoverImageOrFalsePublish(t *testing.T) {
	a, p := mobileVideoFixture(t)
	snapshot, files, err := a.mobilePublishSnapshot(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || len(snapshot.Media) != 1 || snapshot.Media[0].Kind != "video" || snapshot.Media[0].MIME != "video/mp4" || snapshot.Media[0].AssetID != p.AssetIDs[0] {
		t.Fatal("video or cover mixed into snapshot")
	}
	created := decode[miniappCloudSession](t, request(t, a, "POST", "/publications/"+p.ID+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("v", 32)}, 201))
	client, err := readMiniappCloudConfig(a.mobileRoot())
	if err != nil {
		t.Fatal(err)
	}
	// Use the actual local relay created by mobileFixture, with no production API.
	resp, err := http.Post(client.base+"/v1/development/open", "application/json", bytes.NewBufferString(`{"ticket":"`+created.Ticket+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode, string(raw))
	}
	var opened handoffcloud.ReceiverResponse
	if err := json.Unmarshal(raw, &opened); err != nil {
		t.Fatal(err)
	}
	if opened.Envelope.Snapshot.Media[0].Kind != "video" || opened.Envelope.Snapshot.Media[0].SHA256 != snapshot.Media[0].SHA256 {
		t.Fatal("relay changed video")
	}
	after, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if after.PublishedAt != "" || after.ManualStatus == "published" {
		t.Fatal("QR generated false publication")
	}
	request(t, a, "POST", "/publications/"+p.ID+"/status", map[string]any{"status": "published", "revision": p.Revision}, 200)
	record, _ := store.Get[mobileHandoffRecord](a.Store.DB, "mobile_handoffs", p.ID)
	if record.Session.State != "cancelled" {
		t.Fatal("video QR not revoked")
	}
}

func TestMobileVideoRejectsDeletedNonMP4AndMultipleVideos(t *testing.T) {
	for _, scenario := range []string{"deleted", "format", "multiple"} {
		t.Run(scenario, func(t *testing.T) {
			a, p := mobileVideoFixture(t)
			asset, _ := store.Get[domain.Asset](a.Store.DB, "assets", p.AssetIDs[0])
			switch scenario {
			case "deleted":
				asset.DeletedAt = Now()
			case "format":
				asset.MIME = "video/webm"
			case "multiple":
				p.AssetIDs = append(p.AssetIDs, p.AssetIDs[0])
				store.Put(a.Store.DB, "publications", p.ID, p)
			}
			store.Put(a.Store.DB, "assets", asset.ID, asset)
			request(t, a, "POST", "/publications/"+p.ID+"/mobile-handoff", map[string]string{"request_id": strings.Repeat("z", 32)}, 409)
		})
	}
}
