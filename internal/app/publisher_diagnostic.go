package app

type publisherDiagnosticError struct{ message string }

func (e *publisherDiagnosticError) Error() string {
	return e.message + "。可查看本机 logs/xhs-publish-last.png（若截图保存成功）核对官方页面"
}

var publisherDiagnosticMessages = map[string]string{
	"XHS_PUBLISH_button_target":   "未能唯一识别实际发布按钮，本次未点击发布",
	"XHS_PUBLISH_button_disabled": "官方发布按钮不可用，本次未点击发布",
	"XHS_PUBLISH_button_covered":  "发布按钮被其他页面元素遮挡，本次未点击发布",
	"XHS_PUBLISH_verification":    "官方页面要求本人完成验证或实名认证",
	"XHS_PUBLISH_login":           "官方页面要求重新登录",
	"XHS_PUBLISH_media":           "官方页面提示素材上传失败或仍在处理",
	"XHS_PUBLISH_validation":      "官方页面提示文案、封面或声明需要处理",
	"XHS_PUBLISH_rejected":        "官方页面提示提交失败、网络异常或操作频繁",
	"XHS_PUBLISH_dialog":          "官方页面出现待处理弹窗，请核对弹窗内容",
	"XHS_PUBLISH_result_unknown":  "点击发布后等待 60 秒仍未取得可靠结果，不会自动重发",
}
