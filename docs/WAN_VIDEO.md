# 万相视频接口适配（2026-10-11）

此前所有视频模型都拼接方舟的 `/contents/generations/tasks`。将万相配置为阿里云 `/compatible-mode/v1` 时，会请求不存在的接口并返回 HTTP 404。

现在根据万相官方业务空间域名识别协议。支持 `wan3.0-video-prime` 和 `wan3.0-video`，规范模型大小写，并将同域名的 `/compatible-mode/v1` 转为 `/api/v1`。不会修改密钥、业务空间或地域，不会自动提交付费任务。

- 创建：`POST /api/v1/services/aigc/video-generation/video-synthesis`，设置 `X-DashScope-Async: enable`，发送 `model`、`input.prompt` 和 `parameters`。
- 参数：分镜实际时长、9:16、720P、声音选项；关闭提示词自动扩写，使用已确认的分镜描述。
- 查询：保存 `output.task_id` 后使用 `GET /api/v1/tasks/{task_id}`，读取 `output.task_status` 和 `output.video_url`。
- `UNKNOWN` 保持待核实，不把未知任务当作生成成功或自动重新提交。断线且无任务 ID 时沿用提交结果不明保护。
- 下载：仅允许官方 OSS 结果域名的 HTTPS 地址，仍校验 DNS、重定向、文件大小和真实视频格式。
- 连接检测：仅查询业务空间的 `/compatible-mode/v1/models`，不调用收费视频接口；发现模型不等于确认账号的视频生成权限。

重启后，旧万相配置和旧任务的冻结配置会在运行时规范化。此次因错误路径被明确拒绝的任务，可以由用户在导演里选择重试或重做。新配置仍需选择与 API Key 相同地域的业务空间。

新增模拟测试覆盖地址／模型规范化、只读检测、请求体和异步头、远程 ID 持久化、轮询恢复不重复提交、状态映射、结果 URL 及安全下载范围；回归原方舟视频流程。未调用真实付费模型，真实生成权限与效果尚未验证。

协议依据：[阿里云万相3.0视频生成API参考](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)。
