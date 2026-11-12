// Workbench fork: read-only monitoring of the authenticated account's own notes.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-rod/rod"
	"github.com/xpzouying/xiaohongshu-mcp/xiaohongshu"
)

var ownNoteID = regexp.MustCompile(`^[a-fA-F0-9]{24}$`)

type ownMetrics struct {
	Likes     string `json:"likes"`
	Favorites string `json:"favorites"`
	Comments  string `json:"comments"`
	Shares    string `json:"shares"`
	Views     string `json:"views"`
}
type ownNote struct {
	ID          string     `json:"id"`
	AccountID   string     `json:"account_id"`
	Title       string     `json:"title"`
	Kind        string     `json:"kind"`
	PublishedAt int64      `json:"published_at_ms"`
	Metrics     ownMetrics `json:"metrics"`
	DetailState string     `json:"detail_state"`
}
type ownNotesResult struct {
	AccountID string    `json:"account_id"`
	Username  string    `json:"username"`
	Scope     string    `json:"scope"`
	Notes     []ownNote `json:"notes"`
}

func ownCard(f xiaohongshu.Feed, account string) (ownNote, bool) {
	if !ownNoteID.MatchString(f.ID) || f.NoteCard.User.UserID != account || (f.ModelType != "" && f.ModelType != "note") {
		return ownNote{}, false
	}
	m := f.NoteCard.InteractInfo
	return ownNote{ID: f.ID, AccountID: account, Title: f.NoteCard.DisplayTitle, Kind: f.NoteCard.Type, Metrics: ownMetrics{Likes: m.LikedCount, Favorites: m.CollectedCount, Comments: m.CommentCount, Shares: m.SharedCount}, DetailState: "card_only"}, true
}

// Read only the note object; comments, cookies and arbitrary page state never leave this function.
func ownDetail(ctx context.Context, page *rod.Page, id, token, account string) (note xiaohongshu.FeedDetail, err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("详情未能读取")
		}
	}()
	p := page.Context(ctx)
	target := "https://www.xiaohongshu.com/explore/" + id + "?xsec_source=pc_user&xsec_token=" + url.QueryEscape(token)
	if err = p.Navigate(target); err != nil {
		return
	}
	err = p.Wait(rod.Eval(`(id) => !!window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]?.note`, id))
	if err != nil {
		return
	}
	result, e := p.Eval(`(id) => {const n=window.__INITIAL_STATE__.note.noteDetailMap[id].note;return JSON.stringify({noteId:n.noteId,title:n.title,type:n.type,time:n.time,user:{userId:n.user?.userId},interactInfo:n.interactInfo});}`, id)
	if e != nil {
		return note, e
	}
	if err = json.Unmarshal([]byte(result.Value.String()), &note); err != nil {
		return
	}
	if note.NoteID != id || note.User.UserID != account {
		return note, errors.New("作品账号不匹配")
	}
	return
}

func (s *AppServer) ownNotesHandler(c *gin.Context) {
	var req struct {
		AccountID string `json:"account_id"`
	}
	if c.ShouldBindJSON(&req) != nil || req.AccountID == "" {
		c.AbortWithStatus(400)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
	defer cancel()
	b := newBrowser()
	defer b.Close()
	page := b.NewPage()
	defer page.Close()
	if err := verifyPublishingAccount(ctx, page, req.AccountID); err != nil {
		respondError(c, 409, "ACCOUNT_MISMATCH", "请重新核对登录账号", nil)
		return
	}
	user, err := xiaohongshu.NewLogin(page).CurrentUser(ctx)
	if err != nil || user.UserID != req.AccountID {
		respondError(c, 409, "ACCOUNT_MISMATCH", "无法核对账号", nil)
		return
	}
	profile, err := xiaohongshu.NewUserProfileAction(page).GetMyProfileViaSidebar(ctx, xiaohongshu.TabNotes)
	if err != nil {
		respondError(c, 503, "PROFILE_UNAVAILABLE", "未能读取自己的作品列表", nil)
		return
	}
	result := ownNotesResult{AccountID: req.AccountID, Username: user.Nickname, Scope: "profile_loaded_max_20", Notes: []ownNote{}}
	seen := map[string]bool{}
	for _, f := range profile.Feeds {
		n, ok := ownCard(f, req.AccountID)
		if !ok || seen[n.ID] {
			continue
		}
		seen[n.ID] = true
		if len(result.Notes) >= 20 {
			break
		}
		detailCtx, stop := context.WithTimeout(ctx, 10*time.Second)
		detail, e := ownDetail(detailCtx, page, n.ID, f.XsecToken, req.AccountID)
		stop()
		if e == nil {
			n.Title = detail.Title
			n.Kind = detail.Type
			n.PublishedAt = detail.Time
			n.DetailState = "ready"
			m := detail.InteractInfo
			n.Metrics = ownMetrics{Likes: m.LikedCount, Favorites: m.CollectedCount, Comments: m.CommentCount, Shares: m.SharedCount}
		}
		result.Notes = append(result.Notes, n)
	}
	if len(profile.Feeds) > 0 && len(result.Notes) == 0 {
		respondError(c, 503, "PROFILE_UNAVAILABLE", "无法确认作品归属，保留旧数据", nil)
		return
	}
	respondSuccess(c, result, "已读取当前可获取的自己的帖子")
}
