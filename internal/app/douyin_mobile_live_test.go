package app

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

// Explicit opt-in: uploads one test video and revokes its task; never opens a publisher.
func TestDouyinHandoffLiveUploadAndCancel(t *testing.T) {
	root, video := os.Getenv("WORKBENCH_DOUYIN_LIVE_CONFIG"), os.Getenv("WORKBENCH_DOUYIN_LIVE_VIDEO")
	if root == "" || video == "" {
		t.Skip("live cloud test requires explicit private configuration")
	}
	a := testApp(t)
	a.Config.MobilePublishConfigDir = root
	client, e := readDouyinMobileConfig(root)
	if e != nil {
		t.Fatal(e)
	}
	if client.config.LaunchEnvironment != "development" {
		t.Fatal("live check only runs in development mode")
	}
	media, e := os.ReadFile(video)
	if e != nil {
		t.Fatal("missing test video")
	}
	asset := domain.Asset{ID: ID(), Name: "test.mp4", Source: "upload", CreatedAt: Now(), Kind: "video", Status: "ready", Path: "live-test.mp4"}
	if e = os.WriteFile(filepath.Join(a.Config.DataDir, "media", asset.Path), media, 0600); e != nil {
		t.Fatal(e)
	}
	v := domain.Version{ID: ID(), ProjectID: ID(), Status: "confirmed", Content: domain.Content{Title: "网站连通测试，请勿发布", Body: "仅检查上传和撤销，不发布作品。", Topics: []string{}}, Media: &domain.VersionMedia{Kind: "video", AssetIDs: []string{asset.ID}}}
	p := domain.Publication{ID: ID(), ProjectID: v.ProjectID, VersionID: v.ID, TargetPlatform: "douyin", Kind: "video", Ready: true, AssetIDs: v.Media.AssetIDs, Content: v.Content}
	store.Put(a.Store.DB, "assets", asset.ID, asset)
	store.Put(a.Store.DB, "versions", v.ID, v)
	store.Put(a.Store.DB, "publications", p.ID, p)
	path := "/publications/" + p.ID + "/douyin-handoff"
	created := request(t, a, "POST", path, map[string]string{"request_id": strings.ReplaceAll(ID(), "-", "")}, 201)
	var result map[string]any
	if json.Unmarshal(created, &result) != nil || result["state"] != "created" || result["launch_path"] == nil {
		t.Fatal("live task did not reach ready state")
	}
	// Do not log or persist the ticket or signed upload URL.
	request(t, a, "GET", path, nil, 200)
	cancelled := request(t, a, "POST", path+"/cancel", nil, 200)
	if !bytes.Contains(cancelled, []byte(`"state":"cancelled"`)) {
		t.Fatal("test task was not revoked")
	}
}
