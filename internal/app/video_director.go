package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

type videoReference struct {
	ID     string `json:"id"`
	SHA256 string `json:"sha256"`
	Kind   string `json:"kind"`
	Text   string `json:"text,omitempty"`
}
type videoBrief struct {
	AccountContext string                   `json:"account_context,omitempty"`
	CopyKey        string                   `json:"copy_key,omitempty"`
	Creative       *domain.CreativeSettings `json:"creative,omitempty"`
	Mode           string                   `json:"mode,omitempty"`
	ModelID        string                   `json:"model_id"`
	CopyText       string                   `json:"copy_text"`
	Requirements   string                   `json:"requirements"`
	Duration       int                      `json:"duration"`
	ReferenceIDs   []string                 `json:"reference_asset_ids"`
}
type directorShot struct {
	Duration  int    `json:"duration"`
	Visual    string `json:"visual"`
	Camera    string `json:"camera"`
	Narration string `json:"narration"`
}
type videoScript struct {
	SubtitlePlan string           `json:"subtitle_plan,omitempty"`
	Music        string           `json:"music,omitempty"`
	CancelledAt  string           `json:"cancelled_at,omitempty"`
	ID           string           `json:"id"`
	ProjectID    string           `json:"project_id"`
	ParentID     string           `json:"parent_id,omitempty"`
	Title        string           `json:"title"`
	Concept      string           `json:"concept"`
	Style        string           `json:"style"`
	Shots        []directorShot   `json:"shots"`
	Brief        videoBrief       `json:"brief"`
	References   []videoReference `json:"references"`
	Model        string           `json:"model"`
	ConfirmedAt  string           `json:"confirmed_at,omitempty"`
	CreatedAt    string           `json:"created_at"`
}

func isVideoJob(kind string) bool {
	return kind == "video_plan" || kind == "video_generate" || kind == "video_compose"
}
func (a *App) videoModels() ([]rewriteModel, error) {
	m, e := store.Get[[]rewriteModel](a.Store.DB, "settings", "video-models")
	if errors.Is(e, sql.ErrNoRows) {
		return []rewriteModel{}, nil
	}
	for i := range m {
		if svc, err := normalizeVideoService(m[i].Service); err == nil {
			m[i].Service = svc
		}
		m[i].ContinuousMin, m[i].ContinuousMax = continuousVideoRange(m[i].Service)
	}
	return m, e
}
func validateVideoBrief(b videoBrief) error {
	if err := validateCreative(b.Creative); err != nil {
		return err
	}
	if b.Mode != "" && b.Mode != "continuous" {
		return errors.New("视频制作模式无效")
	}
	if b.Mode == "continuous" {
		if b.Duration < 2 || b.Duration > 30 {
			return errors.New("完整连续视频请输入 2～30 秒的整数；实际可用范围取决于所选视频模型，不会自动拆段")
		}
	} else if b.Duration != 15 && b.Duration != 30 && b.Duration != 60 {
		return errors.New("视频时长请选择 15、30 或 60 秒")
	}
	if len([]rune(b.CopyText)) > 12000 || len([]rune(b.Requirements)) > 4000 || len(b.ReferenceIDs) > 7 {
		return errors.New("文案最多 12000 字、要求最多 4000 字，参考素材最多 7 份（视频最多 2 份）")
	}
	if strings.TrimSpace(b.CopyText+b.Requirements) == "" && len(b.ReferenceIDs) == 0 {
		return errors.New("请提供文案或参考素材")
	}
	return nil
}
func validateVideoScript(s videoScript) error {
	if e := validateVideoBrief(s.Brief); e != nil {
		return e
	}
	if len([]rune(s.SubtitlePlan+s.Music)) > 4000 {
		return errors.New("字幕及音乐建议合计不超过4000字")
	}
	if s.Brief.CopyKey != "" && (strings.TrimSpace(s.SubtitlePlan) == "" || strings.TrimSpace(s.Music) == "") {
		return errors.New("完整脚本需要字幕方案和配乐音效建议（无需时填写无）")
	}
	count, duration := videoPlanShape(s.Brief)
	missing := []string{}
	for _, field := range []struct{ label, value string }{{"标题（title）", s.Title}, {"整体故事（concept）", s.Concept}, {"统一风格（style）", s.Style}} {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.label)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("脚本缺少：%s", strings.Join(missing, "、"))
	}
	if len(s.Shots) != count {
		if s.Brief.Mode == "continuous" {
			return fmt.Errorf("连续视频脚本应包含 1 条完整时间线（shots），实际返回 %d 条；总时长需为 %d 秒", len(s.Shots), duration)
		}
		return fmt.Errorf("脚本需要 %d 个分镜（shots），实际返回 %d 个", count, len(s.Shots))
	}
	if len([]rune(s.Title)) > 200 || len([]rune(s.Concept+s.Style)) > 6000 {
		return errors.New("脚本标题或整体描述过长")
	}
	for i, shot := range s.Shots {
		label := videoPartLabel(s, i)
		if shot.Duration != duration {
			return fmt.Errorf("%s时长应为 %d 秒，实际返回 %d 秒", label, duration, shot.Duration)
		}
		if strings.TrimSpace(shot.Visual) == "" {
			return fmt.Errorf("%s缺少画面内容（visual）", label)
		}
		if strings.TrimSpace(shot.Camera) == "" {
			return fmt.Errorf("%s缺少运镜与衔接（camera）", label)
		}
		if len([]rune(shot.Visual+shot.Camera)) > 3000 {
			return fmt.Errorf("%s画面与运镜描述合计不能超过 3000 字", label)
		}
		if len([]rune(shot.Narration)) > duration*4 {
			return fmt.Errorf("%s口播过长：%d 秒最多 %d 字，实际 %d 字；请压缩台词", label, duration, duration*4, len([]rune(shot.Narration)))
		}
	}
	return nil
}
func (a *App) snapshotVideoRefs(ids []string) ([]videoReference, error) {
	refs := []videoReference{}
	seen := map[string]bool{}
	videos := 0
	xs, e := store.List[domain.Extraction](a.Store.DB, "extractions")
	if e != nil {
		return nil, e
	}
	for _, id := range ids {
		v, e := store.Get[domain.Asset](a.Store.DB, "assets", id)
		if e != nil || seen[id] || v.DeletedAt != "" || v.Status != "ready" || (v.Kind != "image" && v.Kind != "video") {
			return nil, errors.New("参考素材不存在、重复或不可用")
		}
		seen[id] = true
		if v.Kind == "image" {
			if _, _, e := a.readImageReference(id, ""); e != nil {
				return nil, e
			}
		} else {
			videos++
			if videos > 2 || v.Duration <= 0 || v.Duration > 600 {
				return nil, errors.New("最多参考 2 个视频，每个不超过 10 分钟")
			}
		}
		ref := videoReference{ID: id, SHA256: v.SHA256, Kind: v.Kind}
		for _, x := range xs {
			if x.AssetID == id && x.Kind == "asr" {
				ref.Text = x.Text
				break
			}
		}
		if len([]rune(ref.Text)) > 12000 {
			return nil, errors.New("参考视频转写超过 12000 字，请使用较短片段")
		}
		refs = append(refs, ref)
	}
	return refs, nil
}
func (a *App) videoBusy(project, kind string) bool {
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		return true
	}
	for _, j := range jobs {
		if j.Target == project && j.Kind == kind && (j.State == "queued" || j.State == "running") {
			return true
		}
	}
	return false
}
func (a *App) videoScripts(c *gin.Context) {
	if _, ok := get[domain.Project](a, c, "projects", c.Param("id")); !ok {
		return
	}
	all, e := store.List[videoScript](a.Store.DB, "video_scripts")
	if e != nil {
		bad(c, e)
		return
	}
	out := []videoScript{}
	for _, s := range all {
		if s.ProjectID == c.Param("id") {
			out = append(out, s)
		}
	}
	c.JSON(200, out)
}
func (a *App) planVideo(c *gin.Context) {
	var req videoBrief
	if !bind(c, &req) {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if err := a.workflowRequiresCopy(p.ID); err != nil {
		bad(c, err)
		return
	}
	if a.videoBusy(p.ID, "video_plan") {
		fail(c, 409, "当前项目正在生成脚本")
		return
	}
	if text := a.workflowCopyText(p.ID); text != "" {
		req.CopyText = text
	}
	if e := validateVideoBrief(req); e != nil {
		bad(c, e)
		return
	}
	if err := a.validateWorkflowReferences(p, req.ReferenceIDs); err != nil {
		bad(c, err)
		return
	}
	models, e := a.planningModels(p.ID, "video-script")
	if e != nil {
		bad(c, e)
		return
	}
	var m *rewriteModel
	for i := range models {
		if models[i].ID == req.ModelID {
			m = &models[i]
		}
	}
	if m == nil || m.Secret == "" {
		fail(c, 400, "脚本模型待配置，请在管理端的视频脚本模型中添加配置")
		return
	}
	if len(req.ReferenceIDs) > 0 && !m.Vision {
		fail(c, 400, "所选视频脚本模型未启用图片输入，请在该模型配置中选择支持图片或图片与视频；也可取消画面参考，仅根据文案规划")
		return
	}
	refs, e := a.snapshotVideoRefs(req.ReferenceIDs)
	if e != nil {
		bad(c, e)
		return
	}
	req.CopyKey = a.workflowCopyKey(p.ID)
	req.AccountContext, e = a.workflowAccountContext(p.ID)
	if e != nil {
		bad(c, e)
		return
	}
	j := newJob("video_plan", p.ID, map[string]any{"brief": req, "references": refs, "model": m.Model, "model_name": m.Name})
	e = a.Store.Transaction(func(tx *sql.Tx) error {
		if e := store.Put(tx, "settings", "video-job-"+j.ID, m.Service); e != nil {
			return e
		}
		return store.Put(tx, "jobs", j.ID, j)
	})
	if e != nil {
		bad(c, e)
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}
func (a *App) saveVideoScript(c *gin.Context) {
	var req videoScript
	if !bind(c, &req) {
		return
	}
	if e := validateVideoScript(req); e != nil {
		bad(c, e)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if err := a.workflowRequiresCopy(p.ID); err != nil {
		bad(c, err)
		return
	}
	if req.ParentID != "" {
		parent, e := store.Get[videoScript](a.Store.DB, "video_scripts", req.ParentID)
		if e != nil || parent.ProjectID != p.ID {
			fail(c, 400, "脚本来源版本无效")
			return
		}
	}
	refs, e := a.snapshotVideoRefs(req.Brief.ReferenceIDs)
	if e != nil {
		bad(c, e)
		return
	}
	// Every edit is a new immutable production input. Old shots/final files remain available.
	req.ID, req.ProjectID, req.CreatedAt, req.ConfirmedAt = ID(), p.ID, Now(), ""
	req.CancelledAt = ""
	req.References = refs
	req.Model = "手动编辑"
	if e = store.Put(a.Store.DB, "video_scripts", req.ID, req); e != nil {
		bad(c, e)
		return
	}
	c.JSON(201, req)
}
func (a *App) confirmVideoScript(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	if err := a.workflowRequiresCopy(p.ID); err != nil {
		bad(c, err)
		return
	}
	s, ok := get[videoScript](a, c, "video_scripts", c.Param("sid"))
	if !ok {
		return
	}
	if s.ProjectID != p.ID {
		fail(c, 404, "脚本不存在")
		return
	}
	if s.CancelledAt != "" {
		fail(c, 409, "脚本已取消，请重新规划")
		return
	}
	if e := validateVideoScript(s); e != nil {
		bad(c, e)
		return
	}
	if key := a.workflowCopyKey(p.ID); key != "" && s.Brief.CopyKey != key {
		fail(c, 409, "文案已变化，请保存并重新确认脚本")
		return
	}
	s.ConfirmedAt = Now()
	if e := store.Put(a.Store.DB, "video_scripts", s.ID, s); e != nil {
		bad(c, e)
		return
	}
	c.JSON(200, s)
}

// Cancellation retires future use of this script; in-flight remote jobs and local assets are retained.
func (a *App) cancelVideoScript(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.editableProject(c, c.Param("id"))
	if !ok {
		return
	}
	s, ok := get[videoScript](a, c, "video_scripts", c.Param("sid"))
	if !ok {
		return
	}
	if s.ProjectID != p.ID {
		fail(c, 404, "脚本不存在")
		return
	}
	if s.CancelledAt == "" {
		s.CancelledAt = Now()
		if err := store.Put(a.Store.DB, "video_scripts", s.ID, s); err != nil {
			bad(c, err)
			return
		}
	}
	c.JSON(200, s)
}
func decodeVideoPayload(j domain.Job, key string, v any) error {
	b, e := json.Marshal(j.Payload[key])
	if e != nil {
		return e
	}
	return json.Unmarshal(b, v)
}
func (a *App) videoReferenceContent(refs []videoReference) ([]any, error) {
	content := []any{}
	for index, ref := range refs {
		v, e := store.Get[domain.Asset](a.Store.DB, "assets", ref.ID)
		if e != nil || v.Status != "ready" || v.DeletedAt != "" || v.SHA256 != ref.SHA256 {
			return nil, errors.New("参考素材已变化或被删除，请重新规划")
		}
		if ref.Kind == "image" {
			_, uri, e := a.readImageReference(ref.ID, ref.SHA256)
			if e != nil {
				return nil, e
			}
			content = append(content, map[string]any{"type": "text", "text": fmt.Sprintf("参考图片 %d", index+1)}, map[string]any{"type": "image_url", "image_url": map[string]string{"url": uri}})
			continue
		}
		f, e := a.openMedia(v.Path)
		if e != nil {
			return nil, e
		}
		hash := sha256.New()
		_, e = io.Copy(hash, f)
		f.Close()
		if e != nil || hex.EncodeToString(hash.Sum(nil)) != ref.SHA256 {
			return nil, errors.New("参考视频文件校验失败")
		}
		path, e := a.mediaPath(v.Path)
		if e != nil {
			return nil, e
		}
		content = append(content, map[string]any{"type": "text", "text": fmt.Sprintf("参考视频 %d，时长 %.1f 秒；以下仅为 4 张均匀采样帧，不代表已观看连续运动或听到声音。已有转写（为空则无）：%s", index+1, v.Duration, ref.Text)})
		for i := 0; i < 4; i++ {
			t := v.Duration * float64(i) / 4
			ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
			out, err := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-ss", fmt.Sprintf("%.3f", t), "-i", path, "-frames:v", "1", "-vf", "scale=768:768:force_original_aspect_ratio=decrease", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1").Output()
			cancel()
			if err != nil || len(out) == 0 || len(out) > 3<<20 {
				return nil, errors.New("参考视频抽帧失败，请检查 FFmpeg 和视频文件")
			}
			content = append(content, map[string]any{"type": "text", "text": fmt.Sprintf("视频 %d，%.1f 秒采样帧", index+1, t)}, map[string]any{"type": "image_url", "image_url": map[string]string{"url": "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(out)}})
		}
	}
	return content, nil
}
func (a *App) runVideoPlan(j domain.Job) (string, error) {
	if _, e := store.Get[videoScript](a.Store.DB, "video_scripts", j.ID); e == nil {
		return j.ID, nil
	}
	var b videoBrief
	var refs []videoReference
	if decodeVideoPayload(j, "brief", &b) != nil || decodeVideoPayload(j, "references", &refs) != nil {
		return "", errors.New("脚本任务输入无效")
	}
	if e := validateVideoBrief(b); e != nil {
		return "", e
	}
	svc, e := store.Get[domain.Service](a.Store.DB, "settings", "video-job-"+j.ID)
	if e != nil {
		return "", e
	}
	content, e := a.videoReferenceContent(refs)
	if e != nil {
		return "", e
	}
	count, duration := videoPlanShape(b)
	prompt := fmt.Sprintf("制作 %d 秒短视频，%d 镜，每镜 %d 秒。用户文案：\n%s\n补充要求：%s\n每镜口播不超过每秒 4 个汉字，可留空。完整脚本要包含开场、发展和收尾、主体/角色一致性、场景动作、景别和运镜。", b.Duration, count, duration, b.CopyText, b.Requirements)
	if b.Mode == "continuous" {
		prompt = fmt.Sprintf("规划一条 %d 秒的完整连续视频，一次生成整条视频，不拆成独立生成的镜头。shots 数组必须只有一个元素，duration 必须为 %d。visual 按时间顺序写出从 0 秒到 %d 秒的连续画面进程，标明每个阶段的起止秒数，阶段无空档、不重叠，最后准确结束在 %d 秒；阶段数按故事需要安排，不固定为三段。只有一次开场、持续推进的发展、一次结尾，各阶段承接上一阶段的人物位置、道具状态与动作结果，不重复介绍或重新讲述同一件事。camera 描述整条视频的连贯运镜和自然过渡；style 锁定人物外貌服装、道具和场景一致性。narration 为整条视频的完整口播，最多 %d 字，可为空。用户文案：\n%s\n补充要求：%s", b.Duration, b.Duration, b.Duration, b.Duration, b.Duration*4, b.CopyText, b.Requirements)
	}
	prompt += creativePrompt(b.Creative, "video")
	prompt += b.AccountContext
	content = append(content, map[string]string{"type": "text", "text": prompt})
	var user any = content
	if len(refs) == 0 {
		user = prompt
	}
	s, e := a.requestVideoPlan(svc, b, user)
	if e != nil {
		return "", e
	}
	s.ID, s.ProjectID, s.CreatedAt, s.ConfirmedAt, s.ParentID, s.Model = j.ID, j.Target, Now(), "", "", svc.Model
	s.Brief = b
	s.References = refs
	if e = validateVideoScript(s); e != nil {
		return "", e
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return s.ID, store.Put(a.Store.DB, "video_scripts", s.ID, s)
}
