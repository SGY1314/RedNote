package app

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func collectMediaFixture(t *testing.T, a *App, platform, identity string) (string, []domain.Asset) {
	t.Helper()
	kind, links := "图文", []any{"https://sns-webpic.xhscdn.com/1.png", "https://sns-webpic.xhscdn.com/2.png"}
	if platform == "douyin" {
		kind, links = "视频", []any{"https://v.douyinvod.com/test.mp4"}
	}
	id, err := a.saveCollected(newJob("collect", "", nil), "https://www."+map[string]string{"xhs": "xiaohongshu", "douyin": "douyin"}[platform]+".com/explore/"+identity, platform, map[string]any{
		"作品ID": identity, "作品类型": kind, "作品标题": "测试", "下载地址": links, "封面地址": "https://p3.douyinpic.com/cover.png",
	})
	if err != nil {
		t.Fatal(err)
	}
	n, _ := store.Get[domain.Note](a.Store.DB, "notes", id)
	r, _ := store.Get[domain.Revision](a.Store.DB, "revisions", n.RevisionID)
	assets := []domain.Asset{}
	for _, aid := range r.AssetIDs {
		v, _ := store.Get[domain.Asset](a.Store.DB, "assets", aid)
		assets = append(assets, v)
	}
	return id, assets
}

func TestCollectionMediaAutoSavesWithoutLibraryPromotion(t *testing.T) {
	for _, platform := range []string{"xhs", "douyin"} {
		t.Run(platform, func(t *testing.T) {
			a := testApp(t)
			noteID, assets := collectMediaFixture(t, a, platform, "123")
			if len(assets) != 2 {
				t.Fatal("missing remote media")
			}
			for _, v := range assets {
				if v.Status != "pending" || v.LibraryState != "collected" || v.Path != "" {
					t.Fatal("collection persisted media")
				}
			}
			jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
			if len(jobs) != 2 {
				t.Fatal("collection did not queue exactly one save per asset")
			}
			library := decode[[]domain.Asset](t, request(t, a, "GET", "/assets", nil, 200))
			if len(library) != 0 {
				t.Fatal("undownloaded media visible in library")
			}
			all := decode[[]domain.Asset](t, request(t, a, "GET", "/assets?include_remote=true", nil, 200))
			if len(all) != 2 {
				t.Fatal("collection cannot preview remote media")
			}
			body := map[string]any{"ids": []string{assets[0].ID, assets[0].ID}}
			first := request(t, a, "POST", "/collections/"+noteID+"/download-media", body, 202)
			second := request(t, a, "POST", "/collections/"+noteID+"/download-media", body, 202)
			if !bytes.Equal(first, second) {
				t.Fatal("repeated selection created new jobs")
			}
			jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
			if len(jobs) != 2 {
				t.Fatal("downloaded unselected media")
			}
			remaining, _ := store.Get[domain.Asset](a.Store.DB, "assets", assets[1].ID)
			if remaining.Status != "pending" || remaining.LibraryState != "collected" {
				t.Fatal("unselected media changed")
			}
		})
	}
}

func TestCollectionMediaSelectionAtomicAndRetry(t *testing.T) {
	a := testApp(t)
	noteID, assets := collectMediaFixture(t, a, "xhs", "123")
	_, other := collectMediaFixture(t, a, "xhs", "456")
	endpoint := "/collections/" + noteID + "/download-media"
	request(t, a, "POST", endpoint, map[string]any{"ids": []string{assets[0].ID, other[0].ID}}, 400)
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(jobs) != 4 {
		t.Fatal("invalid retry batch changed automatic save jobs")
	}
	request(t, a, "POST", endpoint, map[string]any{"ids": []string{assets[0].ID}}, 202)
	jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
	var j domain.Job
	for _, job := range jobs {
		if job.Target == assets[0].ID {
			j = job
		}
	}
	client := &http.Client{Transport: mediaTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 403, Body: io.NopCloser(bytes.NewReader(nil)), Header: make(http.Header)}, nil
	})}
	if _, err := a.runDownloadWithClient(j, client); err == nil {
		t.Fatal("403 accepted")
	}
	j.State = "failed"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	request(t, a, "POST", endpoint, map[string]any{"ids": []string{assets[0].ID}}, 202)
	jobs, _ = store.List[domain.Job](a.Store.DB, "jobs")
	var retry domain.Job
	for _, job := range jobs {
		if job.State == "queued" && job.Target == assets[0].ID {
			retry = job
		}
	}
	image := sampleImage(t, a)
	data, _ := os.ReadFile(filepath.Join(a.Config.DataDir, "media", image.Path))
	client.Transport = mediaTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(data)), Header: make(http.Header)}, nil
	})
	if _, err := a.runDownloadWithClient(retry, client); err != nil {
		t.Fatal(err)
	}
	v, _ := store.Get[domain.Asset](a.Store.DB, "assets", assets[0].ID)
	if v.Status != "ready" || v.Path == "" {
		t.Fatal("not downloaded")
	}
	before, _ := os.ReadDir(filepath.Join(a.Config.DataDir, "media"))
	request(t, a, "POST", endpoint, map[string]any{"ids": []string{v.ID}}, 202)
	if _, err := a.runDownloadWithClient(retry, client); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadDir(filepath.Join(a.Config.DataDir, "media"))
	if len(before) != len(after) {
		t.Fatal("already downloaded file duplicated")
	}
	library := decode[[]domain.Asset](t, request(t, a, "GET", "/assets", nil, 200))
	if len(library) != 1 {
		t.Fatal("collection cache leaked into library")
	}
	request(t, a, "POST", "/assets/"+v.ID+"/save-to-library", nil, 200)
	request(t, a, "POST", "/assets/"+v.ID+"/save-to-library", nil, 200)
	library = decode[[]domain.Asset](t, request(t, a, "GET", "/assets", nil, 200))
	if len(library) != 2 {
		t.Fatal("explicit promotion missing or duplicated")
	}
	promoted, _ := store.Get[domain.Asset](a.Store.DB, "assets", v.ID)
	if promoted.Path != v.Path || promoted.LibraryState != "saved" {
		t.Fatal("promotion copied file or changed cache")
	}
	store.Put(a.Store.DB, "assets", v.ID, promoted)
}

func TestCollectionMediaRetryDouyinCollectedCDN(t *testing.T) {
	a := testApp(t)
	noteID, assets := collectMediaFixture(t, a, "douyin", "7704244765763603752")
	v := assets[0]
	v.RemoteURL = "https://v5-hl-mly-ov.zjcdn.com/video/?sign=SIGNED%2BVALUE"
	v.Status, v.Error = "failed", "下载域名不在允许列表"
	if err := store.Put(a.Store.DB, "assets", v.ID, v); err != nil {
		t.Fatal(err)
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, j := range jobs {
		if j.Target == v.ID {
			j.State = "failed"
			if err := store.Put(a.Store.DB, "jobs", j.ID, j); err != nil {
				t.Fatal(err)
			}
		}
	}
	response := decode[struct {
		JobIDs []string `json:"job_ids"`
	}](t, request(t, a, "POST", "/collections/"+noteID+"/download-media", map[string]any{"ids": []string{v.ID}}, 202))
	if len(response.JobIDs) != 1 {
		t.Fatal("retry did not create one download job")
	}
	job, err := store.Get[domain.Job](a.Store.DB, "jobs", response.JobIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join("..", "..", "web", "tests", "fixtures", "native-reference.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	client := &http.Client{Transport: mediaTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != v.RemoteURL || r.Header.Get("Referer") != "https://www.douyin.com/" || r.Header.Get("Cookie") != "" {
			t.Fatal("signed address or platform headers changed")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}, nil
	})}
	if _, err := a.runDownloadWithClient(job, client); err != nil {
		t.Fatal(err)
	}
	saved, _ := store.Get[domain.Asset](a.Store.DB, "assets", v.ID)
	if saved.Status != "ready" || saved.Error != "" || saved.Kind != "video" || saved.Path == "" || saved.Duration <= 0 || saved.Size != int64(len(body)) || saved.LibraryState != "collected" {
		t.Fatal("retry did not persist a valid video and clear the old error")
	}
	if _, err := a.runDownloadWithClient(job, client); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("retry downloaded an already saved video again")
	}
	cover, _ := store.Get[domain.Asset](a.Store.DB, "assets", assets[1].ID)
	if cover.Status != assets[1].Status || cover.Path != assets[1].Path {
		t.Fatal("retry changed the unselected cover")
	}
}

func TestCollectionMediaLegacyRecovery(t *testing.T) {
	a := testApp(t)
	_, assets := collectMediaFixture(t, a, "xhs", "123")
	legacy := newJob("download", assets[0].ID, nil)
	legacy.State = "running"
	manual := newJob("download", assets[1].ID, map[string]any{"trigger": "manual"})
	manual.State = "running"
	for _, j := range []domain.Job{legacy, manual} {
		store.Put(a.Store.DB, "jobs", j.ID, j)
	}
	// Prevent worker network calls; exercise startup recovery only.
	a.cancel()
	a.StartWorkers()
	l, _ := store.Get[domain.Job](a.Store.DB, "jobs", legacy.ID)
	m, _ := store.Get[domain.Job](a.Store.DB, "jobs", manual.ID)
	if l.State != "cancelled" || m.State != "queued" {
		t.Fatal("legacy auto job resumed or manual download lost")
	}
}

func TestCollectionMediaPreviewStreamsWithoutSaving(t *testing.T) {
	a := testApp(t)
	_, assets := collectMediaFixture(t, a, "douyin", "123")
	calls := 0
	client := &http.Client{Transport: mediaTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Range") != "bytes=0-3" || r.Header.Get("Referer") != "https://www.douyin.com/" {
			t.Error("range/source not forwarded")
		}
		return &http.Response{StatusCode: 206, ContentLength: 4, Body: io.NopCloser(bytes.NewBufferString("test")), Header: http.Header{"Content-Type": []string{"video/mp4"}, "Content-Range": []string{"bytes 0-3/100"}}}, nil
	})}
	router := gin.New()
	router.GET("/:id", func(c *gin.Context) { a.previewCollectionMediaWithClient(c, client) })
	req := httptest.NewRequest("GET", "/"+assets[0].ID, nil)
	req.Header.Set("Range", "bytes=0-3")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 206 || w.Body.String() != "test" || w.Header().Get("Content-Range") != "bytes 0-3/100" {
		t.Fatal(w.Code, w.Body.String())
	}
	files, _ := os.ReadDir(filepath.Join(a.Config.DataDir, "media"))
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	if len(files) != 0 || len(jobs) != 2 {
		t.Fatal("preview persisted or queued media")
	}
	req.Header.Set("Range", "bytes=0-3,6-9")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 416 || calls != 1 {
		t.Fatal("invalid range forwarded")
	}
	v := assets[0]
	v.RemoteURL = "http://127.0.0.1/private"
	store.Put(a.Store.DB, "assets", v.ID, v)
	req.Header.Del("Range")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 400 || calls != 1 {
		t.Fatal("unsafe preview forwarded")
	}
}
