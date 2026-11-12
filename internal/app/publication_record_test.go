package app

import (
	"testing"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestManualPublicationRecordWithoutURL(t *testing.T) {
	for _, platform := range []string{"xhs", "douyin"} {
		t.Run(platform, func(t *testing.T) {
			a := testApp(t)
			p := publishFixture(t, a)
			p.TargetPlatform = platform
			store.Put(a.Store.DB, "publications", p.ID, p)
			at := Now()
			request(t, a, "PATCH", "/publications/"+p.ID, map[string]string{"published_at": at}, 200)
			got, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
			if got.PublishedAt != at || got.OnlineState != "published" || got.PublishedURL != "" || got.RemoteWorkID != "" {
				t.Fatal("manual record requires a link or fabricated remote result")
			}
			jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
			if len(jobs) != 0 {
				t.Fatal("manual recording created a remote task")
			}
		})
	}
}

func TestManualPublicationRecordPreservesKnownLink(t *testing.T) {
	for _, platform := range []string{"xhs", "douyin"} {
		t.Run(platform, func(t *testing.T) {
			a := testApp(t)
			p := publishFixture(t, a)
			p.TargetPlatform = platform
			p.PublishedURL = "https://www.xiaohongshu.com/explore/0123456789abcdef01234567"
			if platform == "douyin" {
				p.PublishedURL = "https://www.douyin.com/video/7590997226031002619"
			}
			p.RemoteWorkID = "known-work"
			store.Put(a.Store.DB, "publications", p.ID, p)
			for _, data := range []map[string]string{
				{"published_at": Now()},
				{"published_at": Now(), "published_url": ""},
			} {
				request(t, a, "PATCH", "/publications/"+p.ID, data, 200)
				got, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
				if got.PublishedURL != p.PublishedURL || got.RemoteWorkID != p.RemoteWorkID {
					t.Fatal("manual edit erased known remote identity")
				}
			}
			request(t, a, "PATCH", "/publications/"+p.ID, map[string]string{"published_at": Now(), "published_url": "https://example.com/post"}, 400)
		})
	}
}
