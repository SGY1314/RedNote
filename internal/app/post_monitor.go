package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type postMetrics struct {
	Likes     string `json:"likes"`
	Favorites string `json:"favorites"`
	Comments  string `json:"comments"`
	Shares    string `json:"shares"`
	Views     string `json:"views"`
}
type postSample struct {
	At      string      `json:"at"`
	Metrics postMetrics `json:"metrics"`
}
type monitoredPost struct {
	ID            string       `json:"id"`
	AccountID     string       `json:"account_id"`
	Title         string       `json:"title"`
	Kind          string       `json:"kind"`
	PublishedAtMS int64        `json:"published_at_ms"`
	DetailState   string       `json:"detail_state"`
	Metrics       postMetrics  `json:"metrics"`
	LastSeen      string       `json:"last_seen"`
	History       []postSample `json:"history"`
}
type postSync struct {
	AccountID   string `json:"account_id"`
	Username    string `json:"username"`
	LastAttempt string `json:"last_attempt"`
	LastSuccess string `json:"last_success"`
	LastError   string `json:"last_error"`
	JobID       string `json:"job_id"`
	Count       int    `json:"count"`
	Scope       string `json:"scope"`
}

var monitorAccountID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var monitorNoteID = regexp.MustCompile(`^[a-fA-F0-9]{24}$`)
var metricValue = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?(?:万|亿|[wWkK])?\+?$`)

func cleanMetric(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 64 || !metricValue.MatchString(s) {
		return ""
	}
	return s
}
func cleanPostMetrics(m postMetrics) postMetrics {
	return postMetrics{cleanMetric(m.Likes), cleanMetric(m.Favorites), cleanMetric(m.Comments), cleanMetric(m.Shares), cleanMetric(m.Views)}
}

func (a *App) listPostMonitor(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	accounts, e := store.List[postSync](a.Store.DB, "post_syncs")
	if e != nil {
		fail(c, 500, "读取同步记录失败")
		return
	}
	all, e := store.List[monitoredPost](a.Store.DB, "own_posts")
	if e != nil {
		fail(c, 500, "读取帖子数据失败")
		return
	}
	posts := []monitoredPost{}
	for _, p := range all {
		if p.AccountID == c.Query("account_id") {
			posts = append(posts, p)
		}
	}
	c.JSON(200, gin.H{"accounts": accounts, "posts": posts})
}

func (a *App) syncOwnPosts(c *gin.Context) {
	var req struct {
		AccountID string `json:"account_id"`
	}
	if !bind(c, &req) {
		return
	}
	if !monitorAccountID.MatchString(req.AccountID) {
		fail(c, 400, "请先扫码连接并检查自己的账号")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		fail(c, 500, "读取任务失败")
		return
	}
	for _, j := range jobs {
		if j.Kind == "post_sync" && j.Target == req.AccountID && (j.State == "queued" || j.State == "running") {
			c.JSON(202, gin.H{"job_id": j.ID})
			return
		}
	}
	s, e := store.Get[postSync](a.Store.DB, "post_syncs", req.AccountID)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		fail(c, 500, "读取同步状态失败")
		return
	}
	j := newJob("post_sync", req.AccountID, nil)
	s.AccountID = req.AccountID
	s.LastAttempt = Now()
	s.LastError = ""
	s.JobID = j.ID
	e = a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "jobs", j.ID, j); e != nil {
			return e
		}
		return store.Put(tx, "post_syncs", s.AccountID, s)
	})
	if e != nil {
		fail(c, 500, "创建同步任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}

func (a *App) runPostSync(j domain.Job) (result string, err error) {
	a.publisherMu.Lock()
	defer a.publisherMu.Unlock()
	defer func() {
		if recover() != nil {
			err = errors.New("帖子读取中断，请检查账号连接后重试")
		}
		if err != nil {
			a.mu.Lock()
			defer a.mu.Unlock()
			s, e := store.Get[postSync](a.Store.DB, "post_syncs", j.Target)
			if e == nil && s.JobID == j.ID {
				s.LastError = err.Error()
				_ = store.Put(a.Store.DB, "post_syncs", j.Target, s)
			}
		}
	}()
	ctx, cancel := context.WithTimeout(a.ctx, 5*time.Minute+10*time.Second)
	defer cancel()
	// A retry of an older job becomes this account's current attempt as well.
	a.mu.Lock()
	current, readErr := store.Get[postSync](a.Store.DB, "post_syncs", j.Target)
	if readErr == nil {
		current.JobID = j.ID
		current.LastAttempt = Now()
		current.LastError = ""
		readErr = store.Put(a.Store.DB, "post_syncs", j.Target, current)
	}
	a.mu.Unlock()
	if readErr != nil {
		return "", errors.New("保存同步状态失败")
	}
	var response struct {
		AccountID string          `json:"account_id"`
		Username  string          `json:"username"`
		Scope     string          `json:"scope"`
		Notes     []monitoredPost `json:"notes"`
	}
	if err = a.publisherCall(ctx, "POST", "/api/v1/monitor/own-notes", map[string]string{"account_id": j.Target}, &response); err != nil {
		return
	}
	if response.AccountID != j.Target || response.Scope != "profile_loaded_max_20" || response.Notes == nil || len(response.Notes) > 20 {
		return "", errors.New("账号或作品返回数据异常，本地旧记录已保留")
	}
	seen := map[string]bool{}
	for _, p := range response.Notes {
		if p.AccountID != j.Target || !monitorNoteID.MatchString(p.ID) || seen[p.ID] || len(p.Title) > 4000 || (p.DetailState != "ready" && p.DetailState != "card_only") {
			return "", errors.New("作品归属或数据异常，本地旧记录已保留")
		}
		seen[p.ID] = true
	}
	now := Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	err = a.Store.Transaction(func(tx *sql.Tx) error {
		s, e := store.Get[postSync](tx, "post_syncs", j.Target)
		if e != nil {
			return e
		}
		for _, p := range response.Notes {
			key := j.Target + ":" + p.ID
			prev, e := store.Get[monitoredPost](tx, "own_posts", key)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return e
			}
			p.History = prev.History
			p.Metrics = cleanPostMetrics(p.Metrics)
			if p.PublishedAtMS < 0 || p.PublishedAtMS > time.Now().Add(24*time.Hour).UnixMilli() {
				p.PublishedAtMS = 0
			}
			p.LastSeen = now
			// Keep old metadata when this pass can only read the profile card.
			if p.PublishedAtMS <= 0 {
				p.PublishedAtMS = prev.PublishedAtMS
			}
			if p.Title == "" {
				p.Title = prev.Title
			}
			p.History = append(p.History, postSample{At: now, Metrics: p.Metrics})
			if len(p.History) > 30 {
				p.History = p.History[len(p.History)-30:]
			}
			if e = store.Put(tx, "own_posts", key, p); e != nil {
				return e
			}
		}
		s.Username = response.Username
		s.LastSuccess = now
		s.LastError = ""
		s.Count = len(response.Notes)
		s.Scope = response.Scope
		return store.Put(tx, "post_syncs", j.Target, s)
	})
	if err != nil {
		return "", errors.New("保存帖子数据失败，旧记录已保留")
	}
	return fmt.Sprintf("已同步 %d 篇可读取的帖子；未返回的历史帖子继续保留", len(response.Notes)), nil
}
