package app

import (
	"errors"
	"fmt"
	"strings"

	"xhs-workbench/internal/domain"
)

// Text-only generation limits from the official Wan and Ark API references.
// Unknown model aliases do not inherit a duration range from another model.
func continuousVideoRange(s domain.Service) (int, int) {
	model := strings.ToLower(strings.TrimSpace(s.Model))
	if isWanService(s) && (model == "wan3.0-video" || model == "wan3.0-video-prime") {
		return 2, 30
	}
	switch {
	case strings.HasPrefix(model, "doubao-seedance-2-5-"):
		return 4, 30
	case strings.HasPrefix(model, "doubao-seedance-2-0-"):
		return 4, 15
	case strings.HasPrefix(model, "doubao-seedance-1-5-pro-"):
		return 4, 12
	case strings.HasPrefix(model, "doubao-seedance-1-0-pro-"):
		return 2, 12
	}
	return 0, 0
}

func validateContinuousVideo(s videoScript, svc domain.Service) error {
	if s.Brief.Mode != "continuous" {
		return nil // Keep historical multi-shot productions resumable.
	}
	if e := validateVideoScript(s); e != nil {
		return e
	}
	min, max := continuousVideoRange(svc)
	if max == 0 {
		return errors.New("尚未确认该模型的单次连续视频时长范围，请选择万相 3.0 或已支持的 Seedance 模型")
	}
	if s.Brief.Duration < min || s.Brief.Duration > max {
		return fmt.Errorf("模型 %s 单次支持 %d～%d 秒，当前脚本为 %d 秒；请调整时长重新规划或更换模型，不会自动拆段", svc.Model, min, max, s.Brief.Duration)
	}
	return nil
}

func videoScenePrompt(s videoScript, i int) string {
	scene := s.Shots[i]
	if s.SubtitlePlan != "" || s.Music != "" {
		return fmt.Sprintf("完整故事：%s\n统一风格：%s\n本镜时长：%d 秒\n画面与时间线：%s\n运镜与转场：%s\n旁白：%s\n字幕方案：%s\n配乐及音效：%s", s.Concept, s.Style, scene.Duration, scene.Visual, scene.Camera, scene.Narration, s.SubtitlePlan, s.Music)
	}
	if s.Brief.Mode == "continuous" {
		return fmt.Sprintf("生成一条完整连续的 %d 秒视频，一次完成整条时间线。只开场一次，事件按时间顺序推进，结尾只出现一次；不得重复演绎同一事件或在阶段交界重置人物与场景。\n完整故事：%s\n统一主体与风格：%s\n从 0 到 %d 秒的连续画面时间线：%s\n贯穿整条视频的运镜与过渡：%s\n完整中文口播（按叙事进度讲述一次）：%s\n无背景音乐，不添加字幕或画面文字。", s.Brief.Duration, s.Concept, s.Style, s.Brief.Duration, scene.Visual, scene.Camera, scene.Narration)
	}
	return fmt.Sprintf("完整故事：%s\n统一主体与风格：%s\n第 %d/%d 镜（只制作本镜）：%s\n景别、运镜和衔接：%s\n中文台词：%s\n无背景音乐，不添加字幕或画面文字。", s.Concept, s.Style, i+1, len(s.Shots), scene.Visual, scene.Camera, scene.Narration)
}

func videoPartLabel(s videoScript, i int) string {
	if s.Brief.Mode == "continuous" {
		return "完整视频"
	}
	return fmt.Sprintf("第 %d/%d 镜", i+1, len(s.Shots))
}
