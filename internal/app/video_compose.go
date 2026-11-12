package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func (a *App) composeVideo(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.editableProject(c, c.Param("id")); !ok {
		return
	}
	j, ok := get[domain.Job](a, c, "jobs", c.Param("jid"))
	if !ok {
		return
	}
	if j.Target != c.Param("id") || j.Kind != "video_generate" || j.State != "succeeded" {
		fail(c, 409, "全部镜头生成成功后才能合成")
		return
	}
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		bad(c, e)
		return
	}
	for _, v := range jobs {
		if v.Kind == "video_compose" && asString(v.Payload["generation_id"]) == j.ID {
			c.JSON(202, gin.H{"job_id": v.ID})
			return
		}
	}
	if a.videoBusy(j.Target, "video_compose") {
		fail(c, 409, "当前项目正在合成另一个视频版本，请完成后再提交")
		return
	}
	next, e := a.enqueue("video_compose", j.Target, map[string]any{"generation_id": j.ID})
	if e != nil {
		bad(c, e)
		return
	}
	c.JSON(202, gin.H{"job_id": next.ID})
}
func (a *App) ffmpegVideo(args ...string) error {
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Minute)
	defer cancel()
	args = append([]string{"-nostdin", "-hide_banner", "-loglevel", "error", "-y"}, args...)
	if e := exec.CommandContext(ctx, "ffmpeg", args...).Run(); e != nil {
		return errors.New("本地视频处理失败，请检查 FFmpeg、素材文件和剩余磁盘空间")
	}
	return nil
}
func (a *App) runVideoCompose(j domain.Job) (string, error) {
	if v, e := store.Get[domain.Asset](a.Store.DB, "assets", j.ID); e == nil {
		if _, e = a.mediaPath(v.Path); e != nil {
			return "", e
		}
		return v.ID, nil
	}
	source, e := store.Get[domain.Job](a.Store.DB, "jobs", asString(j.Payload["generation_id"]))
	if e != nil || source.State != "succeeded" {
		return "", errors.New("镜头任务尚未完成")
	}
	var p videoProduction
	if decodeVideoPayload(source, "production", &p) != nil || len(p.Shots) == 0 {
		return "", errors.New("镜头记录无效")
	}
	script, e := store.Get[videoScript](a.Store.DB, "video_scripts", p.ScriptID)
	if e != nil {
		return "", e
	}
	dir, e := os.MkdirTemp(filepath.Join(a.Config.DataDir, "tmp"), "video-compose-")
	if e != nil {
		return "", e
	}
	defer os.RemoveAll(dir)
	list := []string{}
	for i, clip := range p.Shots {
		v, e := store.Get[domain.Asset](a.Store.DB, "assets", clip.AssetID)
		if e != nil || v.Status != "ready" || v.Duration <= 0 {
			return "", errors.New("镜头素材不可用")
		}
		if i >= len(script.Shots) || v.Duration < float64(script.Shots[i].Duration)-1 || v.Duration > float64(script.Shots[i].Duration)+1 {
			return "", fmt.Errorf("第 %d 镜实际时长与脚本不符，请检查后制作新版本", i+1)
		}
		path, e := a.mediaPath(v.Path)
		if e != nil {
			return "", e
		}
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
		audio, e := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", path).Output()
		cancel()
		if e != nil {
			return "", errors.New("无法检查镜头音轨")
		}
		args := []string{"-i", path}
		audioMap := "0:a:0"
		if !p.Audio || strings.TrimSpace(string(audio)) == "" {
			args = append(args, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo")
			audioMap = "1:a:0"
		}
		name := fmt.Sprintf("clip-%02d.mp4", i)
		target := filepath.Join(dir, name)
		args = append(args, "-map", "0:v:0", "-map", audioMap, "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-af", "apad", "-t", fmt.Sprintf("%.3f", v.Duration), "-map_metadata", "-1", "-movflags", "+faststart", target)
		if e = a.ffmpegVideo(args...); e != nil {
			return "", e
		}
		list = append(list, "file '"+name+"'")
	}
	manifest := filepath.Join(dir, "clips.txt")
	if e = os.WriteFile(manifest, []byte(strings.Join(list, "\n")), 0600); e != nil {
		return "", e
	}
	output := filepath.Join(dir, "final.mp4")
	if e = a.ffmpegVideo("-f", "concat", "-safe", "1", "-i", manifest, "-c", "copy", "-movflags", "+faststart", output); e != nil {
		return "", e
	}
	coverPath := filepath.Join(dir, "cover.jpg")
	if e = a.ffmpegVideo("-i", output, "-frames:v", "1", coverPath); e != nil {
		return "", e
	}
	v := domain.Asset{ID: j.ID, Name: "视频成片", Kind: "video", Source: "generated", LibraryState: "result", Category: "AI 视频", CreatedAt: Now()}
	cover := domain.Asset{ID: j.ID + "-cover", Name: "视频封面", Kind: "image", Source: "generated", LibraryState: "result", Category: "AI 视频", CreatedAt: Now()}
	a.tagVideoAsset(&v, script)
	a.tagVideoAsset(&cover, script)
	for _, item := range []struct {
		path  string
		asset *domain.Asset
	}{{output, &v}, {coverPath, &cover}} {
		f, e := os.Open(item.path)
		if e != nil {
			return "", e
		}
		e = a.ingest(f, item.asset)
		f.Close()
		if e != nil {
			return "", e
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	current, e := store.Get[domain.Job](a.Store.DB, "jobs", j.ID)
	if e != nil {
		return "", e
	}
	current.Payload["asset_id"], current.Payload["cover_id"], current.Payload["script_id"] = v.ID, cover.ID, script.ID
	e = a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "assets", v.ID, v); e != nil {
			return e
		}
		if e := store.Put(tx, "assets", cover.ID, cover); e != nil {
			return e
		}
		return store.Put(tx, "jobs", j.ID, current)
	})
	return v.ID, e
}
