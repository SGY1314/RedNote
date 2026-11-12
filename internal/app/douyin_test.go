package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func mockDouyin(t *testing.T, a *App, submit *int, mode string) {
	t.Helper()
	a.douyinTest = func(_ context.Context, op string, arg, result any) error {
		account := douyinAccount{UserID: "12345678901", Username: "模拟账号", LoggedIn: true, MainVerified: false, CreatorVerified: true, State: "success"}
		if mode == "main_only" {
			account.MainVerified = true
			account.CreatorVerified = false
		}
		if mode == "logged_out" {
			account.LoggedIn = false
		}
		var out any
		switch op {
		case "prepare":
			d := arg.(douyinDraft)
			if d.AccountID != account.UserID || len(d.Files) != 1 || d.Files[0].SHA256 == "" {
				t.Fatal("invalid prepare payload")
			}
			out = map[string]any{"prepared_id": "editor-1", "account": account, "verified": true, "image": "data:image/png;base64,aGVsbG8="}
			if mode == "manual" || mode == "manual_bad" {
				reason := "editor_media_unverified"
				if mode == "manual_bad" {
					reason = "upload_failed"
				}
				out = map[string]any{"account": account, "verified": false, "manual_review": true, "publication_id": d.PublicationID, "review_reason": reason}
			}
			if mode == "wrong_account" {
				account.UserID = "99999999999"
				out = map[string]any{"prepared_id": "editor-1", "account": account, "verified": true, "image": "data:image/png;base64,aGVsbG8="}
			}
		case "submit":
			*submit++
			pubs, _ := store.List[domain.Publication](a.Store.DB, "publications")
			if pubs[0].OnlineState != "submitting" || pubs[0].SubmittedAt == "" {
				t.Fatal("must persist before submit")
			}
			if mode == "unknown" {
				return errors.New("disconnected")
			}
			out = map[string]any{"work_id": "7123456789012345678", "state": "submitted"}
		case "account", "login_status":
			out = account
		case "logout", "open_browser":
			out = douyinAccount{}
		default:
			return errors.New("unexpected operation")
		}
		b, _ := json.Marshal(out)
		return json.Unmarshal(b, result)
	}
}
func douyinFixture(t *testing.T, a *App) domain.Publication {
	p := publishFixture(t, a)
	p.TargetPlatform = "douyin"
	p.Title = "抖音测试"
	store.Put(a.Store.DB, "publications", p.ID, p)
	return p
}
func prepareFixture(t *testing.T, a *App, p domain.Publication) douyinPreview {
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]string{"account_id": "12345678901", "visibility": "self"}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	if _, e := a.runDouyinPrepare(j); e != nil {
		t.Fatal(e)
	}
	j.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	v := decode[douyinPreview](t, request(t, a, "GET", "/publications/"+p.ID+"/publish-preview", nil, 200))
	if v.Token == "" || v.Account.UserID != "12345678901" {
		t.Fatal("missing confirmation")
	}
	return v
}
func TestDouyinConfirmOnceAndSubmittedNotPublished(t *testing.T) {
	a := testApp(t)
	p := douyinFixture(t, a)
	calls := 0
	mockDouyin(t, a, &calls, "")
	v := prepareFixture(t, a, p)
	if v.Account.MainVerified || !v.Account.CreatorVerified || !v.Account.LoggedIn {
		t.Fatal("creator-only login must prepare successfully")
	}
	if calls != 0 {
		t.Fatal("prepare submitted")
	}
	path := "/publications/" + p.ID + "/publish"
	request(t, a, "POST", path, map[string]any{"token": v.Token, "confirm": false}, 409)
	request(t, a, "POST", path, map[string]any{"token": "wrong", "confirm": true}, 409)
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", path, map[string]any{"token": v.Token, "confirm": true}, 202))
	request(t, a, "POST", path, map[string]any{"token": v.Token, "confirm": true}, 409)
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	if _, e := a.runDouyinSubmit(j); e != nil {
		t.Fatal(e)
	}
	current, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if calls != 1 || current.OnlineState != "submitted" || current.PublishedAt != "" || current.RemoteWorkID == "" {
		t.Fatal("incorrect publication proof")
	}
	request(t, a, "POST", "/jobs/"+j.ID+"/retry", nil, 409)
}

func TestDouyinManualEditorHandoffCannotSubmit(t *testing.T) {
	a := testApp(t)
	p := douyinFixture(t, a)
	calls := 0
	mockDouyin(t, a, &calls, "manual")
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]string{"account_id": "12345678901", "visibility": "self"}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	result, err := a.runDouyinPrepare(j)
	if err != nil || !strings.Contains(result, "尚未确认上传完成") {
		t.Fatal(result, err)
	}
	j.State = "succeeded"
	store.Put(a.Store.DB, "jobs", j.ID, j)
	current, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if current.OnlineState != "manual_review" || current.PublishedAt != "" || current.SubmittedAt != "" || current.RemoteWorkID != "" {
		t.Fatal("handoff must not mark submission", current)
	}
	request(t, a, "GET", "/publications/"+p.ID+"/publish-preview", nil, 409)
	request(t, a, "POST", "/publications/"+p.ID+"/publish", map[string]any{"confirm": true, "token": ""}, 409)
	request(t, a, "POST", "/platforms/douyin/browser", map[string]string{"target": "editor", "publication_id": p.ID}, 200)
	request(t, a, "POST", "/platforms/douyin/browser", map[string]string{"target": "editor", "publication_id": "wrong"}, 409)
	if calls != 0 {
		t.Fatal("manual review submitted")
	}
	a.recoverDouyin()
	current, _ = store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if current.OnlineState != "failed" || current.PublishedAt != "" {
		t.Fatal("restart kept stale editor state")
	}
}

func TestDouyinUploadFailureCannotMasqueradeAsManualHandoff(t *testing.T) {
	a := testApp(t)
	p := douyinFixture(t, a)
	calls := 0
	mockDouyin(t, a, &calls, "manual_bad")
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]string{"account_id": "12345678901", "visibility": "self"}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	if _, err := a.runDouyinPrepare(j); err == nil {
		t.Fatal("upload error accepted as handoff")
	}
	current, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if current.OnlineState != "failed" {
		t.Fatal("failure state lost")
	}
}
func TestDouyinExpiredChangedAndRestartedPreview(t *testing.T) {
	for _, mode := range []string{"expired", "file", "restart", "logout", "content"} {
		t.Run(mode, func(t *testing.T) {
			a := testApp(t)
			p := douyinFixture(t, a)
			calls := 0
			mockDouyin(t, a, &calls, "")
			v := prepareFixture(t, a, p)
			switch mode {
			case "expired":
				x := a.douyinPreviews[p.ID]
				x.ExpiresAt = time.Now().Add(-time.Second).Format(time.RFC3339)
				a.douyinPreviews[p.ID] = x
			case "file":
				asset, _ := store.Get[domain.Asset](a.Store.DB, "assets", p.AssetIDs[0])
				path, _ := a.mediaPath(asset.Path)
				os.WriteFile(path, []byte("changed"), 0600)
			case "restart":
				a.recoverDouyin()
			case "logout":
				request(t, a, "POST", "/platforms/douyin/logout", nil, 200)
			case "content":
				p.OnlineState = "prepared"
				p.Body = "changed"
				store.Put(a.Store.DB, "publications", p.ID, p)
			}
			request(t, a, "POST", "/publications/"+p.ID+"/publish", map[string]any{"token": v.Token, "confirm": true}, 409)
			if calls != 0 {
				t.Fatal("invalid preview submitted")
			}
		})
	}
}
func TestDouyinUnknownNeverAutomaticallyResubmits(t *testing.T) {
	a := testApp(t)
	p := douyinFixture(t, a)
	calls := 0
	mockDouyin(t, a, &calls, "unknown")
	v := prepareFixture(t, a, p)
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish", map[string]any{"token": v.Token, "confirm": true}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	if _, e := a.runDouyinSubmit(j); e == nil {
		t.Fatal("unknown marked success")
	}
	a.recoverDouyin()
	current, _ := store.Get[domain.Publication](a.Store.DB, "publications", p.ID)
	if current.OnlineState != "unknown" || current.PublishedAt != "" || calls != 1 {
		t.Fatal("unknown state missing")
	}
	request(t, a, "POST", "/jobs/"+j.ID+"/retry", nil, 409)
	request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]string{"account_id": "12345678901", "visibility": "public"}, 409)
}
func TestDouyinPlatformLinksAndDedupe(t *testing.T) {
	links := parseLinks("分享 https://v.douyin.com/abcDef/ https://www.douyin.com/video/7123456789012345678 https://douyin.com.evil.com/video/7123456789012345678 https://www.douyin.com:123/video/7123456789012345678")
	if len(links) != 2 {
		t.Fatal(links)
	}
	a := testApp(t)
	data := map[string]any{"作品ID": "7123456789012345678", "作品类型": "视频", "作品标题": "测试", "下载地址": []any{"https://v.douyinvod.com/video.mp4"}, "点赞数量": float64(0)}
	xhs := domain.Note{ID: ID(), Platform: "xhs", NoteID: "7123456789012345678"}
	store.Put(a.Store.DB, "notes", xhs.ID, xhs)
	j := newJob("collect", "", map[string]any{})
	id, e := a.saveCollected(j, "https://www.douyin.com/video/7123456789012345678", "douyin", data)
	if e != nil || id == xhs.ID {
		t.Fatal(e, "cross platform collision")
	}
	duplicate, e := a.saveCollected(j, "https://www.douyin.com/video/7123456789012345678", "douyin", data)
	if e != nil || id != duplicate {
		t.Fatal("dedupe failed")
	}
	n, _ := store.Get[domain.Note](a.Store.DB, "notes", id)
	if n.Likes == nil || *n.Likes != 0 || n.Favorites != nil {
		t.Fatal("unknown converted to zero")
	}
	response := request(t, a, "GET", "/collections?platform=douyin", nil, 200)
	if strings.Contains(string(response), xhs.ID) {
		t.Fatal("filter leaked other platform")
	}
}
func TestDouyinWrongAccountFailsPreparation(t *testing.T) {
	a := testApp(t)
	p := douyinFixture(t, a)
	calls := 0
	mockDouyin(t, a, &calls, "wrong_account")
	got := decode[struct {
		ID string `json:"job_id"`
	}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]string{"account_id": "12345678901", "visibility": "public"}, 202))
	j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
	if _, e := a.runDouyinPrepare(j); e == nil {
		t.Fatal("wrong account accepted")
	}
	request(t, a, "GET", "/publications/"+p.ID+"/publish-preview", nil, 409)
}

func TestDouyinMissingCreatorIdentityBlocksPreparation(t *testing.T) {
	for _, mode := range []string{"main_only", "logged_out"} {
		t.Run(mode, func(t *testing.T) {
			a := testApp(t)
			p := douyinFixture(t, a)
			calls := 0
			mockDouyin(t, a, &calls, mode)
			got := decode[struct {
				ID string `json:"job_id"`
			}](t, request(t, a, "POST", "/publications/"+p.ID+"/publish-prepare", map[string]string{"account_id": "12345678901", "visibility": "public"}, 202))
			j, _ := store.Get[domain.Job](a.Store.DB, "jobs", got.ID)
			if _, err := a.runDouyinPrepare(j); err == nil {
				t.Fatal("unverified creator accepted")
			}
			request(t, a, "GET", "/publications/"+p.ID+"/publish-preview", nil, 409)
			if calls != 0 {
				t.Fatal("failed preparation submitted")
			}
		})
	}
}
