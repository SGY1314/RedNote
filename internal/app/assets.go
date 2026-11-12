package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	mimepkg "mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

const maxMedia = 512 << 20

func (a *App) openMedia(rel string) (*os.File, error) {
	if rel == "" || !filepath.IsLocal(rel) {
		return nil, errors.New("素材访问越界")
	}
	root, e := os.OpenRoot(filepath.Join(a.Config.DataDir, "media"))
	if e != nil {
		return nil, e
	}
	defer root.Close()
	// Root.Open confines traversal (including symlinks) to this directory.
	return root.Open(rel)
}
func (a *App) mediaPath(rel string) (string, error) {
	f, e := a.openMedia(rel)
	if e != nil {
		return "", e
	}
	f.Close()
	return filepath.Abs(filepath.Join(a.Config.DataDir, "media", rel))
}
func (a *App) ingest(reader io.Reader, asset *domain.Asset) error {
	temp, e := os.CreateTemp(filepath.Join(a.Config.DataDir, "tmp"), "media-*")
	if e != nil {
		return e
	}
	name := temp.Name()
	defer os.Remove(name)
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(temp, h), io.LimitReader(reader, maxMedia+1))
	temp.Close()
	if e != nil {
		return errors.New("读取媒体失败")
	}
	if n > maxMedia {
		return errors.New("文件超过 512 MB 限制")
	}
	if n == 0 {
		return errors.New("媒体文件为空")
	}
	f, e := os.Open(name)
	if e != nil {
		return e
	}
	head := make([]byte, 512)
	count, _ := f.Read(head)
	f.Seek(0, 0)
	mime := http.DetectContentType(head[:count])
	ext := ""
	kind := ""
	switch mime {
	case "image/jpeg":
		ext = ".jpg"
		kind = "image"
	case "image/png":
		ext = ".png"
		kind = "image"
	case "image/gif":
		ext = ".gif"
		kind = "image"
	case "image/webp":
		ext = ".webp"
		kind = "image"
	case "video/mp4":
		ext = ".mp4"
		kind = "video"
	case "video/webm":
		ext = ".webm"
		kind = "video"
	}
	if kind == "" && count > 12 && string(head[4:8]) == "ftyp" {
		brand := string(head[8:12])
		if brand == "qt  " {
			kind = "video"
			mime = "video/quicktime"
			ext = ".mov"
		}
	}
	if kind == "image" {
		cfg, _, err := image.DecodeConfig(f)
		if err == nil {
			asset.Width = cfg.Width
			asset.Height = cfg.Height
		}
		if err != nil && mime != "image/webp" {
			f.Close()
			return errors.New("图片文件损坏或格式不支持")
		}
	}
	f.Close()
	if kind == "" {
		return errors.New("仅支持 JPEG、PNG、WebP、GIF、MP4、MOV、WebM")
	}
	if asset.Kind != "" && asset.Kind != kind {
		return errors.New("媒体实际类型与预期不一致")
	}
	if kind == "video" || mime == "image/webp" {
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", name).Output()
		if err != nil {
			if kind == "video" {
				return errors.New("视频检查失败，请检查 FFprobe 是否安装以及视频是否损坏")
			}
		} else {
			var probe struct {
				Streams []struct {
					Type   string `json:"codec_type"`
					Width  int    `json:"width"`
					Height int    `json:"height"`
				} `json:"streams"`
				Format struct {
					Duration string `json:"duration"`
				} `json:"format"`
			}
			if json.Unmarshal(out, &probe) != nil {
				return errors.New("媒体检查结果无效")
			}
			found := false
			for _, st := range probe.Streams {
				if st.Type == "video" {
					found = true
					asset.Width = st.Width
					asset.Height = st.Height
					break
				}
			}
			if !found {
				return errors.New("素材中没有有效画面")
			}
			asset.Duration, _ = strconv.ParseFloat(probe.Format.Duration, 64)
		}
	}
	rel := asset.ID + "-" + ID()[:8] + ext
	dst := filepath.Join(a.Config.DataDir, "media", rel)
	if _, e := os.Stat(dst); e == nil {
		return errors.New("不可覆盖现有素材")
	}
	if e = os.Rename(name, dst); e != nil {
		return e
	}
	asset.Path = rel
	asset.Kind = kind
	asset.MIME = mime
	asset.Size = n
	asset.SHA256 = hex.EncodeToString(h.Sum(nil))
	asset.Status = "ready"
	asset.Error = ""
	return nil
}
func (a *App) upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxMedia+2<<20)
	file, header, e := c.Request.FormFile("file")
	if e != nil {
		fail(c, 400, "请选择文件，单个文件不能超过 512 MB")
		return
	}
	defer file.Close()
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	name := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	category, e := validCategory(c.PostForm("category"))
	if e != nil {
		bad(c, e)
		return
	}
	projectID := strings.TrimSpace(c.PostForm("project_id"))
	if projectID != "" {
		if _, ok := a.editableProject(c, projectID); !ok {
			return
		}
	}
	asset := domain.Asset{ID: ID(), Name: name, OriginalName: name, Category: category, Source: "upload", ProjectID: projectID, CreatedAt: Now()}
	if e = a.ingest(file, &asset); e != nil {
		bad(c, e)
		return
	}
	a.mu.Lock()
	e = store.Put(a.Store.DB, "assets", asset.ID, asset)
	a.mu.Unlock()
	if e != nil {
		fail(c, 500, "保存素材记录失败")
		return
	}
	c.JSON(201, a.assetPresentation(asset))
}
func (a *App) assetFile(c *gin.Context) {
	v, ok := get[domain.Asset](a, c, "assets", c.Param("id"))
	if !ok {
		return
	}
	if v.Status != "ready" {
		fail(c, 409, "素材尚未下载完成")
		return
	}
	f, e := a.openMedia(v.Path)
	if e != nil {
		fail(c, 404, "无法打开素材")
		return
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		fail(c, 500, "无法读取素材")
		return
	}
	c.Header("Content-Type", v.MIME)
	if c.Query("download") == "1" {
		name := a.assetPresentation(v).Name
		ext := filepath.Ext(v.Path)
		if name == "" {
			name = v.ID
		}
		if !strings.EqualFold(filepath.Ext(name), ext) {
			name += ext
		}
		c.Header("Content-Disposition", mimepkg.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	http.ServeContent(c.Writer, c.Request, v.Name, info.ModTime(), f)
}
func (a *App) runDownload(j domain.Job) (string, error) {
	return a.runDownloadWithClient(j, adapter.MediaClient())
}
func (a *App) runDownloadWithClient(j domain.Job, client *http.Client) (string, error) {
	v, e := store.Get[domain.Asset](a.Store.DB, "assets", j.Target)
	if e != nil {
		return "", e
	}
	if v.Status == "ready" {
		return v.ID, nil
	}
	if v.DeletedAt != "" {
		return "", errors.New("素材已删除，请先恢复再下载")
	}
	if v.Source == "collection" && asString(j.Payload["trigger"]) != "manual" && asString(j.Payload["trigger"]) != "collection_auto" {
		return "", errors.New("请在采集库重试保存图片或视频")
	}
	var source string
	if revision, readErr := store.Get[domain.Revision](a.Store.DB, "revisions", v.RevisionID); readErr == nil {
		source = revision.URL
	}
	e = a.downloadMedia(&v, source, client)
	a.mu.Lock()
	defer a.mu.Unlock()
	// A user can rename or classify a pending download. Preserve those edits
	// instead of writing the older metadata loaded before the network request.
	if latest, readErr := store.Get[domain.Asset](a.Store.DB, "assets", v.ID); readErr == nil {
		v.Name, v.OriginalName, v.Category, v.UpdatedAt = latest.Name, latest.OriginalName, latest.Category, latest.UpdatedAt
		v.NameCustomized = latest.NameCustomized
		v.LibraryState = latest.LibraryState
		v.DeletedAt = latest.DeletedAt
	}
	if e != nil {
		v.Status = "failed"
		v.Error = e.Error()
	}
	if se := store.Put(a.Store.DB, "assets", v.ID, v); se != nil {
		return "", se
	}
	return v.ID, e
}

func (a *App) downloadMedia(v *domain.Asset, source string, client *http.Client) error {
	req, err := adapter.MediaRequest(a.ctx, v.RemoteURL, source)
	if err != nil {
		return err
	}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("媒体下载失败，请稍后重试；地址过期时在笔记详情重新采集")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return adapter.MediaStatusError(res.StatusCode)
	}
	return a.ingest(res.Body, v)
}
func (a *App) extractAsset(c *gin.Context) {
	v, ok := get[domain.Asset](a, c, "assets", c.Param("id"))
	if !ok {
		return
	}
	if v.Status != "ready" {
		fail(c, 409, "素材尚未就绪")
		return
	}
	kind := "ocr"
	if v.Kind == "video" {
		kind = "asr"
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	j, e := a.enqueue(kind, v.ID, map[string]any{"trigger": "manual"})
	if e != nil {
		fail(c, 500, "创建任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}
func (a *App) editExtraction(c *gin.Context) {
	var req struct {
		Text     string           `json:"text"`
		Segments []domain.Segment `json:"segments"`
	}
	if !bind(c, &req) {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	x, ok := get[domain.Extraction](a, c, "extractions", c.Param("id"))
	if !ok {
		return
	}
	if x.Kind == "asr" {
		var end int64
		lines := []string{}
		for _, s := range req.Segments {
			if s.StartMS < end || s.EndMS <= s.StartMS {
				fail(c, 400, "转写时间段必须有序且不重叠")
				return
			}
			end = s.EndMS
			lines = append(lines, s.Text)
		}
		if len(req.Segments) == 0 {
			fail(c, 400, "转写需要保留时间段")
			return
		}
		x.Segments = req.Segments
		x.Text = strings.Join(lines, "\n")
	} else {
		x.Text = req.Text
	}
	x.Edited = true
	x.UpdatedAt = Now()
	if e := store.Put(a.Store.DB, "extractions", x.ID, x); e != nil {
		fail(c, 500, "保存失败")
		return
	}
	c.JSON(200, x)
}
