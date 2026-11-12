package app

import (
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"time"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func newJob(kind, target string, p map[string]any) domain.Job {
	return domain.Job{ID: ID(), Kind: kind, Target: target, Payload: p, State: "queued", Stage: "等待执行", CreatedAt: Now(), UpdatedAt: Now()}
}
func (a *App) enqueue(kind, target string, p map[string]any) (domain.Job, error) {
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		return domain.Job{}, e
	}
	for _, j := range jobs {
		if j.Kind == kind && j.Target == target && (j.State == "queued" || j.State == "running") {
			return j, nil
		}
	}
	j := newJob(kind, target, p)
	return j, store.Put(a.Store.DB, "jobs", j.ID, j)
}
func (a *App) StartWorkers() {
	a.recoverDouyin()
	a.mu.Lock()
	jobs, _ := store.List[domain.Job](a.Store.DB, "jobs")
	for _, j := range jobs {
		if j.Kind == "download" && asString(j.Payload["trigger"]) != "manual" && asString(j.Payload["trigger"]) != "collection_auto" && (j.State == "queued" || j.State == "running" || j.State == "blocked" || j.State == "failed") {
			v, err := store.Get[domain.Asset](a.Store.DB, "assets", j.Target)
			if err == nil && v.Source == "collection" && v.Status != "ready" {
				j.State, j.Stage, j.Error = "cancelled", "采集媒体改为手动选择下载", ""
				j.UpdatedAt = Now()
				v.Status, v.Error = "remote", ""
				store.Put(a.Store.DB, "jobs", j.ID, j)
				store.Put(a.Store.DB, "assets", v.ID, v)
				continue
			}
		}
		if j.Kind == "export" && (j.State == "queued" || j.State == "running" || j.State == "blocked" || j.State == "needs_review") {
			j.State = "cancelled"
			j.Stage = "发布包导出功能已移除"
			j.Error = ""
			j.UpdatedAt = Now()
			store.Put(a.Store.DB, "jobs", j.ID, j)
			continue
		}
		if j.Kind == "ocr" && asString(j.Payload["trigger"]) != "manual" && (j.State == "queued" || j.State == "blocked" || j.State == "failed") {
			j.State = "cancelled"
			j.Stage = "已停用旧版自动 OCR，请手动选择图片"
			j.Error = ""
			j.UpdatedAt = Now()
			store.Put(a.Store.DB, "jobs", j.ID, j)
			continue
		}
		if j.State == "running" {
			if j.Kind == "collect" || j.Kind == "download" || j.Kind == "export" || j.Kind == "cleanup" || j.Kind == "post_sync" || j.Kind == "video_compose" || (j.Kind == "video_generate" && videoCanResume(j)) {
				j.State = "queued"
				j.Stage = "重启后恢复"
			} else {
				j.State = "needs_review"
				j.Error = "上次运行中断，调用结果不明；请核实后手动重试，可能再次计费"
				if j.Kind == "video_generate" {
					j.Error = errVideoUnknown.Error()
				}
				if j.Kind == "publish" {
					j.Error = errPublishReview.Error()
				}
			}
			j.UpdatedAt = Now()
			store.Put(a.Store.DB, "jobs", j.ID, j)
		}
	}
	a.queueCollectionBackfill()
	a.mu.Unlock()
	for kind, n := range map[string]int{"angle_recommend": 1, "title_rewrite": 1, "copy_rewrite": 1, "collect": 1, "download": 1, "ocr": 2, "asr": 1, "rewrite": 1, "angle_suggest": 1, "image_generation": 1, "image_plan": 1, "video_plan": 1, "video_generate": 1, "video_compose": 1, "cleanup": 1, "publish": 1, "post_sync": 1, "douyin_prepare": 1, "douyin_submit": 1} {
		for i := 0; i < n; i++ {
			a.wg.Add(1)
			go a.worker(kind)
		}
	}
}
func (a *App) worker(kind string) {
	defer a.wg.Done()
	ticker := time.NewTicker(700 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-ticker.C:
		}
		a.mu.Lock()
		next, nextErr := store.NextJob[domain.Job](a.Store.DB, kind)
		jobs := []domain.Job{}
		if nextErr == nil {
			jobs = append(jobs, next)
		}
		var job *domain.Job
		for i := len(jobs) - 1; i >= 0; i-- {
			if jobs[i].Kind == kind && jobs[i].State == "queued" {
				j := jobs[i]
				j.State = "running"
				j.Attempts++
				j.Stage = map[string]string{"collect": "读取笔记元数据", "download": "下载并检查媒体", "ocr": "识别图片文字", "asr": "提取音轨并转写", "rewrite": "生成仿写内容", "angle_suggest": "建议发帖角度", "image_plan": "根据文案和参考图规划画面", "video_plan": "根据文案与参考素材规划完整脚本", "video_generate": "制作视频镜头", "video_compose": "本地合成成片", "export": "打包发布素材", "cleanup": "清理彻底删除的素材"}[kind]
				j.UpdatedAt = Now()
				if kind == "image_generation" {
					j.Stage = "生成图片并保存到本地"
				}
				if kind == "publish" {
					j.Stage = "检查账号、上传素材并填写文案（不发布）"
				}
				if kind == "post_sync" {
					j.Stage = "读取自己账号的帖子数据"
				}
				if e := store.Put(a.Store.DB, "jobs", j.ID, j); e == nil {
					job = &j
				}
				break
			}
		}
		a.mu.Unlock()
		if job == nil {
			continue
		}
		result, e := a.execute(*job)
		a.mu.Lock()
		current, readErr := store.Get[domain.Job](a.Store.DB, "jobs", job.ID)
		if readErr == nil {
			current.UpdatedAt = Now()
			current.Result = result
			if e != nil {
				current.State = "failed"
				current.Error = e.Error()
				if errors.Is(e, errConfig) {
					current.State = "blocked"
				}
				if errors.Is(e, errPublishReview) || errors.Is(e, errVideoUnknown) {
					current.State = "needs_review"
				}
				if a.ctx.Err() != nil {
					if kind == "collect" || kind == "download" || kind == "export" || kind == "cleanup" || kind == "post_sync" || kind == "video_compose" || (kind == "video_generate" && videoCanResume(current)) {
						current.State = "queued"
						current.Stage = "等待重启后恢复"
						current.Error = ""
					} else {
						current.State = "needs_review"
						current.Error = "服务停止时调用未完成，请核实后手动重试"
						if kind == "video_generate" {
							current.Error = errVideoUnknown.Error()
						}
						if kind == "publish" {
							current.Error = errPublishReview.Error()
						}
					}
				}
			} else {
				current.State = "succeeded"
				current.Stage = "完成"
				current.Error = ""
			}
			store.Put(a.Store.DB, "jobs", current.ID, current)
		}
		a.mu.Unlock()
	}
}
func (a *App) execute(j domain.Job) (result string, err error) {
	defer func() {
		if recover() != nil {
			err = fmt.Errorf("任务异常，请检查输入或重试")
			if j.Kind == "publish" {
				err = errPublishReview
			}
		}
	}()
	switch j.Kind {
	case "video_plan":
		if j.Payload["workflow_script"] == true {
			return a.runWorkflowVideoScript(j)
		}
		return a.runVideoPlan(j)
	case "video_generate":
		return a.runVideoGenerate(j)
	case "video_compose":
		return a.runVideoCompose(j)
	case "douyin_prepare":
		return a.runDouyinPrepare(j)
	case "douyin_submit":
		return a.runDouyinSubmit(j)
	case "post_sync":
		return a.runPostSync(j)
	case "publish":
		return a.runPublish(j)
	case "collect":
		return a.runCollect(j)
	case "download":
		return a.runDownload(j)
	case "ocr":
		return a.runOCR(j)
	case "asr":
		return a.runASR(j)
	case "angle_suggest":
		return a.runAngleSuggestions(j)
	case "angle_recommend":
		return a.runWorkflowAngles(j)
	case "title_rewrite":
		return a.runTitleRewrite(j)
	case "copy_rewrite":
		return a.runCopyRewrite(j)
	case "rewrite":
		return a.runRewrite(j)
	case "image_plan":
		return a.runImagePlan(j)
	case "image_generation":
		return a.runImageGeneration(j)
	case "export":
		return a.runExport(j)
	case "cleanup":
		return a.runCleanup(j)
	}
	return "", errors.New("未知任务类型")
}
func (a *App) retryJob(c *gin.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	j, ok := get[domain.Job](a, c, "jobs", c.Param("id"))
	if !ok {
		return
	}
	if j.Kind == "export" {
		fail(c, 410, "发布包导出功能已移除")
		return
	}
	if j.Kind == "publish" || j.Kind == "douyin_submit" || j.Kind == "douyin_prepare" {
		fail(c, 409, "发布任务不能直接重试，请在发布管理核实结果后重新提交")
		return
	}
	if j.State == "running" || j.State == "queued" || j.State == "succeeded" {
		fail(c, 409, "此任务无需重试")
		return
	}
	if j.Kind == "video_generate" && !videoCanResume(j) {
		fail(c, 409, errVideoUnknown.Error())
		return
	}
	if j.Kind == "angle_recommend" || j.Kind == "title_rewrite" || j.Kind == "copy_rewrite" || j.Kind == "rewrite" || j.Kind == "angle_suggest" || j.Kind == "image_generation" || j.Kind == "image_plan" || isVideoJob(j.Kind) {
		if _, ok := a.editableProject(c, j.Target); !ok {
			return
		}
	}
	jobs, e := store.List[domain.Job](a.Store.DB, "jobs")
	if e != nil {
		fail(c, 500, "读取任务失败")
		return
	}
	for _, other := range jobs {
		if other.ID != j.ID && other.Kind == j.Kind && other.Target == j.Target && (other.State == "queued" || other.State == "running") {
			fail(c, 409, "同一步骤已有任务执行中")
			return
		}
	}
	j.State = "queued"
	j.HistoryDeletedAt = ""
	if j.Kind == "ocr" || j.Kind == "download" {
		if j.Payload == nil {
			j.Payload = map[string]any{}
		}
		j.Payload["trigger"] = "manual"
	}
	j.Error = ""
	j.UpdatedAt = Now()
	if e := store.Put(a.Store.DB, "jobs", j.ID, j); e != nil {
		fail(c, 500, "保存任务失败")
		return
	}
	c.JSON(202, gin.H{"job_id": j.ID})
}
