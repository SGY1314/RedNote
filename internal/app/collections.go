package app

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

var linkPattern = regexp.MustCompile(`https?://[^\s<>"，。；！？”）]+`)
var notePattern = regexp.MustCompile(`/(?:explore|discovery/item|user/profile/[^/]+)/([a-zA-Z0-9]+)`)

func parseLinks(text string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range linkPattern.FindAllString(text, -1) {
		raw = strings.TrimRight(raw, ".,;!?)]}")
		u, e := url.Parse(raw)
		if e != nil || u.User != nil || u.Port() != "" {
			continue
		}
		h := strings.ToLower(u.Hostname())
		if h == "www.douyin.com" || h == "douyin.com" || h == "v.douyin.com" {
			if !validDouyinLink(raw) {
				continue
			}
			raw = canonicalDouyinLink(raw)
			if !seen[raw] {
				out = append(out, raw)
				seen[raw] = true
			}
			continue
		}
		if h != "www.xiaohongshu.com" && h != "xiaohongshu.com" && h != "xhslink.com" && h != "xhslink.cn" {
			continue
		}
		if strings.Contains(h, "xiaohongshu") && !notePattern.MatchString(u.Path) {
			continue
		}
		if !seen[raw] {
			out = append(out, raw)
			seen[raw] = true
		}
	}
	return out
}
func (a *App) collect(c *gin.Context) {
	var req struct {
		Text     string `json:"text"`
		Platform string `json:"platform"`
	}
	if !bind(c, &req) {
		return
	}
	links := parseLinks(req.Text)
	if req.Platform != "" && req.Platform != "xhs" && req.Platform != "douyin" {
		fail(c, 400, "请选择小红书或抖音")
		return
	}
	for _, link := range links {
		if platform, _ := linkIdentity(link); req.Platform != "" && platform != req.Platform {
			fail(c, 400, "链接中包含其他平台的作品，请切换到对应平台后采集")
			return
		}
	}
	if len(links) == 0 {
		fail(c, 400, "未识别到有效的小红书笔记或抖音视频链接")
		return
	}
	if len(links) > 50 {
		fail(c, 400, "单次最多提交 50 条链接")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	notes, _ := store.List[domain.Note](a.Store.DB, "notes")
	results := []gin.H{}
	for _, u := range links {
		existing := ""
		deleted := false
		platform, identity := linkIdentity(u)
		for _, n := range notes {
			if n.Platform == platform && (n.URL == u || identity != "" && n.NoteID == identity) {
				existing = n.ID
				deleted = n.DeletedAt != ""
				break
			}
		}
		if existing != "" {
			results = append(results, gin.H{"url": u, "platform": platform, "note_id": existing, "duplicate": true, "deleted": deleted})
			continue
		}
		j, e := a.enqueue("collect", u, map[string]any{"url": u})
		if e != nil {
			fail(c, 500, "保存任务失败")
			return
		}
		results = append(results, gin.H{"url": u, "platform": platform, "job_id": j.ID})
	}
	c.JSON(202, gin.H{"items": results})
}
func (a *App) recollect(c *gin.Context) {
	n, ok := get[domain.Note](a, c, "notes", c.Param("id"))
	if !ok {
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if !bind(c, &req) {
		return
	}
	u := n.URL
	if req.URL != "" {
		links := parseLinks(req.URL)
		if len(links) != 1 {
			fail(c, 400, "请输入一个有效笔记链接")
			return
		}
		u = links[0]
		if platform, _ := linkIdentity(u); platform != n.Platform {
			fail(c, 400, "重采链接不能更换平台")
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	j, e := a.enqueue("collect", u, map[string]any{"url": u, "recollect": true, "expected_note": n.NoteID})
	if e != nil {
		fail(c, 500, "保存任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}
func (a *App) notes(c *gin.Context) {
	all, e := store.List[domain.Note](a.Store.DB, "notes")
	if e != nil {
		fail(c, 500, "查询失败")
		return
	}
	items := []domain.Note{}
	q := strings.ToLower(c.Query("q"))
	allTags := map[string]bool{}
	for _, note := range all {
		if note.DeletedAt == "" {
			for _, tag := range note.Tags {
				allTags[tag] = true
			}
		}
	}
	for _, n := range all {
		if (n.DeletedAt != "") != (c.Query("deleted") == "true") {
			continue
		}
		body := ""
		if q != "" {
			if rev, err := store.Get[domain.Revision](a.Store.DB, "revisions", n.RevisionID); err == nil {
				body = rev.Body
			}
		}
		if q != "" && !strings.Contains(strings.ToLower(n.Title+" "+n.Author+" "+strings.Join(n.Tags, " ")+" "+body), q) {
			continue
		}
		if platform := c.Query("platform"); platform != "" && n.Platform != platform {
			continue
		}
		if k := c.Query("kind"); k != "" && n.Kind != k {
			continue
		}
		if tag := c.Query("tag"); tag != "" && !strings.Contains(strings.Join(n.Tags, "|"), tag) {
			continue
		}
		items = append(items, n)
	}
	sort.SliceStable(items, func(i, j int) bool {
		left, right := items[i], items[j]
		cmp := strings.Compare(left.UpdatedAt, right.UpdatedAt)
		var x, y int64
		numericSort := true
		number := func(v *int64) int64 {
			if v == nil {
				return -1
			}
			return *v
		}
		switch c.Query("sort") {
		case "likes":
			x, y = number(left.Likes), number(right.Likes)
		case "favorites":
			x, y = number(left.Favorites), number(right.Favorites)
		case "comments":
			x, y = number(left.Comments), number(right.Comments)
		case "rating":
			x, y = int64(left.Rating), int64(right.Rating)
		case "created_at":
			cmp = strings.Compare(left.CreatedAt, right.CreatedAt)
			numericSort = false
		default:
			numericSort = false
		}
		if numericSort {
			cmp = 0
			if x < y {
				cmp = -1
			}
			if x > y {
				cmp = 1
			}
		}
		if cmp == 0 {
			return left.ID < right.ID
		}
		if c.Query("order") == "asc" {
			return cmp < 0
		}
		return cmp > 0
	})
	total := len(items)
	page := intQuery(c, "page", 1)
	size := intQuery(c, "page_size", 20)
	if size > 100 {
		size = 100
	}
	start := (page - 1) * size
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	type noteCard struct {
		domain.Note
		Body   string   `json:"body"`
		Topics []string `json:"topics"`
	}
	cards := []noteCard{}
	for _, n := range items[start:end] {
		rev, _ := store.Get[domain.Revision](a.Store.DB, "revisions", n.RevisionID)
		cards = append(cards, noteCard{Note: n, Body: rev.Body, Topics: rev.Topics})
	}
	tags := []string{}
	for tag := range allTags {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	c.JSON(200, gin.H{"items": cards, "total": total, "tags": tags})
}
func (a *App) noteDetail(c *gin.Context) {
	n, ok := get[domain.Note](a, c, "notes", c.Param("id"))
	if !ok {
		return
	}
	revID := c.Query("revision_id")
	if revID == "" {
		revID = n.RevisionID
	}
	rev, ok := get[domain.Revision](a, c, "revisions", revID)
	if !ok {
		return
	}
	if rev.NoteID != n.ID {
		fail(c, 404, "修订不存在")
		return
	}
	assets := []domain.Asset{}
	exs := []domain.Extraction{}
	allEx, _ := store.List[domain.Extraction](a.Store.DB, "extractions")
	for _, id := range rev.AssetIDs {
		v, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if e == nil {
			assets = append(assets, v)
		}
		for _, x := range allEx {
			if x.AssetID == id {
				exs = append(exs, x)
			}
		}
	}
	revs, _ := store.List[domain.Revision](a.Store.DB, "revisions")
	history := []domain.Revision{}
	for _, v := range revs {
		if v.NoteID == n.ID {
			history = append(history, v)
		}
	}
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	related := []domain.Job{}
	for _, j := range jobs {
		match := j.Result == n.ID || j.Target == n.URL
		for _, id := range rev.AssetIDs {
			if j.Target == id {
				match = true
			}
		}
		if match {
			related = append(related, j)
		}
	}
	c.JSON(200, gin.H{"note": n, "revision": rev, "history": history, "assets": assets, "extractions": exs, "jobs": related})
}
func (a *App) updateNote(c *gin.Context) {
	var req struct {
		Tags   *[]string `json:"tags"`
		Rating *int      `json:"rating"`
	}
	if !bind(c, &req) {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	n, ok := get[domain.Note](a, c, "notes", c.Param("id"))
	if !ok {
		return
	}
	if req.Rating != nil {
		if *req.Rating < 0 || *req.Rating > 5 {
			fail(c, 400, "评分应为 0 至 5 星")
			return
		}
		n.Rating = *req.Rating
	}
	if req.Tags != nil {
		if len(*req.Tags) > 20 {
			fail(c, 400, "最多添加 20 个个人标签")
			return
		}
		clean := []string{}
		seen := map[string]bool{}
		for _, tag := range *req.Tags {
			tag = strings.TrimSpace(tag)
			if utf8.RuneCountInString(tag) > 40 {
				fail(c, 400, "单个标签最多 40 字")
				return
			}
			if tag != "" && !seen[tag] {
				clean = append(clean, tag)
				seen[tag] = true
			}
		}
		n.Tags = clean
	}
	if e := store.Put(a.Store.DB, "notes", n.ID, n); e != nil {
		fail(c, 500, "保存失败")
		return
	}
	c.JSON(200, n)
}
func numeric(v any) *int64 {
	s := strings.TrimSpace(fmt.Sprint(v))
	s = strings.ReplaceAll(s, ",", "")
	mult := float64(1)
	if strings.HasSuffix(s, "万") {
		mult = 10000
		s = strings.TrimSuffix(s, "万")
	}
	if strings.HasSuffix(strings.ToLower(s), "w") {
		mult = 10000
		s = s[:len(s)-1]
	}
	n, e := strconv.ParseFloat(s, 64)
	if e != nil || n < 0 {
		return nil
	}
	i := int64(n * mult)
	return &i
}
func texts(v any) []string {
	r := []string{}
	switch x := v.(type) {
	case []any:
		for _, a := range x {
			if s, ok := a.(string); ok && s != "" {
				r = append(r, s)
			}
		}
	case string:
		r = strings.Fields(x)
	}
	return r
}
func (a *App) runCollect(j domain.Job) (string, error) {
	raw := asString(j.Payload["url"])
	if platform, _ := linkIdentity(raw); platform == "douyin" {
		return a.runDouyinCollect(j)
	}
	u, _ := url.Parse(raw)
	if u == nil {
		return "", errors.New("链接无效")
	}
	if strings.HasPrefix(u.Hostname(), "xhslink.") {
		if e := adapter.AllowedURL(raw); e != nil {
			return "", e
		}
		req, _ := http.NewRequestWithContext(a.ctx, "GET", raw, nil)
		res, e := adapter.MediaClient().Do(req)
		if e != nil {
			return "", errors.New("短链接解析失败，请换用最新分享链接")
		}
		res.Body.Close()
		raw = res.Request.URL.String()
		links := parseLinks(raw)
		if len(links) != 1 || !strings.Contains(res.Request.URL.Hostname(), "xiaohongshu.com") {
			return "", errors.New("短链接未指向小红书笔记")
		}
	}
	s := a.settings()
	body := jsonString(map[string]any{"url": raw, "download": false, "check_record": false, "cookie": ""})
	req, _ := http.NewRequestWithContext(a.ctx, "POST", s.CollectorURL+"/xhs/detail", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Collector-Token", a.CollectorToken)
	res, e := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if e != nil {
		return "", errors.New("采集服务不可用或超时，请检查 Python 服务")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", adapter.StatusError(res.StatusCode)
	}
	// Decode only data; never retain, log or return the upstream params field.
	var envelope struct {
		Data      map[string]any `json:"data"`
		ErrorCode string         `json:"error_code"`
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 10<<20)).Decode(&envelope); e != nil {
		return "", errors.New("采集响应格式错误")
	}
	if envelope.ErrorCode != "" {
		return "", collectionError(envelope.ErrorCode)
	}
	d := envelope.Data
	identity := asString(d["作品ID"])
	if identity == "" {
		return "", collectionError("page_unrecognized")
	}
	if expected := asString(j.Payload["expected_note"]); expected != "" && expected != identity {
		return "", errors.New("新链接与原笔记 ID 不一致")
	}
	return a.saveCollected(j, raw, "xhs", d)
}
func (a *App) saveCollected(j domain.Job, raw, platform string, d map[string]any) (string, error) {
	identity := asString(d["作品ID"])
	if expected := asString(j.Payload["expected_note"]); expected != "" && expected != identity {
		return "", errors.New("新链接与原作品 ID 不一致")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	all, _ := store.List[domain.Note](a.Store.DB, "notes")
	n := domain.Note{ID: ID(), Platform: platform, NoteID: identity, Tags: []string{}, CreatedAt: Now()}
	for _, old := range all {
		if old.Platform == platform && old.NoteID == identity {
			n = old
			if j.Payload["recollect"] != true {
				if n.DeletedAt != "" {
					return "", errors.New("这篇笔记已在回收站，请在采集库的回收站中恢复")
				}
				return n.ID, nil
			}
			break
		}
	}
	kind := "image"
	if strings.Contains(asString(d["作品类型"]), "视频") {
		kind = "video"
	}
	r := domain.Revision{ID: ID(), NoteID: n.ID, URL: raw, Title: asString(d["作品标题"]), Body: asString(d["作品描述"]), Topics: texts(d["作品标签"]), Author: asString(d["作者昵称"]), AuthorID: asString(d["作者ID"]), PublishedAt: asString(d["发布时间"]), Kind: kind, AssetIDs: []string{}, CreatedAt: Now()}
	assets := []domain.Asset{}
	add := func(link, k, role string) {
		if link == "" {
			return
		}
		id := ID()
		asset := domain.Asset{ID: id, Name: fmt.Sprintf("%s-%02d", identity, len(assets)+1), Kind: k, Source: "collection", LibraryState: "collected", RemoteURL: link, RevisionID: r.ID, Role: role, Position: len(assets), Status: "pending", CreatedAt: Now()}
		assets = append(assets, asset)
		r.AssetIDs = append(r.AssetIDs, id)
	}
	for _, link := range texts(d["下载地址"]) {
		add(link, kind, "media")
	}
	if kind == "video" {
		add(asString(d["封面地址"]), "image", "cover")
	}
	for _, link := range texts(d["动图地址"]) {
		if link != "NaN" {
			add(link, "video", "live")
		}
	}
	n.Title = r.Title
	n.Author = r.Author
	n.Kind = kind
	n.URL = raw
	n.RevisionID = r.ID
	n.Likes = numeric(d["点赞数量"])
	n.Favorites = numeric(d["收藏数量"])
	n.Comments = numeric(d["评论数量"])
	n.UpdatedAt = Now()
	e := a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "notes", n.ID, n); e != nil {
			return e
		}
		if e := store.Put(tx, "revisions", r.ID, r); e != nil {
			return e
		}
		for _, asset := range assets {
			if e := store.Put(tx, "assets", asset.ID, asset); e != nil {
				return e
			}
		}
		for _, asset := range assets {
			job := newJob("download", asset.ID, map[string]any{"trigger": "collection_auto"})
			if e := store.Put(tx, "jobs", job.ID, job); e != nil {
				return e
			}
		}
		return nil
	})
	return n.ID, e
}

// Use our own messages, never reflect arbitrary upstream errors or params.
func collectionError(code string) error {
	messages := map[string]string{
		"network_unreachable": "采集进程无法连接小红书（网络连接失败）。请检查网络；若由受限开发环境启动，请先停止工作台，再双击项目中的 start.cmd 启动后重试。",
		"tls_error":           "连接小红书时证书校验失败，请检查本机时间、代理或证书配置。",
		"login_required":      "这篇笔记受到小红书登录限制，当前无法直接采集。请确认笔记可以公开访问，或换一条公开笔记链接。",
		"access_restricted":   "小红书拒绝了此次访问（HTTP 403）。请在浏览器检查笔记是否可打开，复制最新分享链接后再试。",
		"note_unavailable":    "笔记不存在或已不可访问（HTTP 404/410），请检查并重新复制分享链接。",
		"rate_limited":        "小红书限制了请求频率，请稍后重试。",
		"missing_share_token": "页面未返回笔记内容，且链接缺少分享校验参数。请粘贴完整的分享文字或带参数的笔记链接。",
		"page_unrecognized":   "已访问小红书页面，但未取得可解析的笔记内容。可能是登录限制或页面结构变化，请在浏览器确认笔记可打开后使用最新分享链接重试。",
		"parse_failed":        "笔记页面解析失败，可能是页面结构变化，请使用最新分享链接重试。",
		"unsafe_redirect":     "采集地址或重定向目标未通过安全检查。请使用小红书官方分享链接。",
		"too_many_redirects":  "小红书页面重定向次数过多，请使用最新分享链接重试。",
		"upstream_error":      "小红书页面暂时返回异常，请稍后重试。",
	}
	if message, ok := messages[code]; ok {
		return errors.New(message)
	}
	return errors.New("采集服务返回未知错误，请检查服务版本后重试")
}
