package app

import "strings"

// 模型能力分组是前台工作区与后台管理控制台共用的唯一标识集合。
// 两侧 URL 形态不同（/rewrite-models 与 /admin/models/rewrite），但落到这里的
// 分组必须一致，否则同一份配置会在两个入口被读成不同的目录。
var modelCapabilities = []string{
	"rewrite", "image", "video",
	"angle", "title", "copy", "image-plan", "video-script",
}

// parseModelCapability 只接受白名单内的分组。后台路由参数直接来自 URL，
// 静默降级（把拼错的分组当成 rewrite）会让管理操作落到错误的目录上，
// 因此返回 ok=false 由调用方明确拒绝。
func parseModelCapability(raw string) (string, bool) {
	value := strings.TrimSpace(strings.ToLower(raw))
	for _, capability := range modelCapabilities {
		if capability == value {
			return capability, true
		}
	}
	return "", false
}

// modelsSettingsKey 是分组到 settings 表主键的唯一映射。保存与删除必须共用它：
// 两处各写一遍正是历史上「删掉一组、留下另一组」的来源。
func modelsSettingsKey(capability string) string {
	return capability + "-models"
}

// capabilityFromPath 把前台工作区路由映射为分组。路由形态固定为
// /api/v1/<capability>-models[/...]，匹配时要求分组名后紧跟边界，
// 避免 /video-script-models 被误判成 video、/x-modelsheet 被误判成 x。
func capabilityFromPath(path string) (string, bool) {
	for _, capability := range modelCapabilities {
		prefix := "/api/v1/" + modelsSettingsKey(capability)
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return capability, true
		}
	}
	return "", false
}

// capabilityOrGroup 把可能的 HTTP 错误统一成 modelSaveError，便于入口原样回传状态码。
func capabilityError() error {
	return saveModelError(404, "模型分组不存在")
}
