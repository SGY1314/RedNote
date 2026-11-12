# 代码审查与重构报告（2026-11-02）

范围：`RedNote-Source` 全量（Go 后端 / React 前端 / Python 采集 / 小程序与发布组件）。
原则：只修真实缺陷与结构歧义，保持对外行为不变；无常驻 Git 仓库，故每处改动均配套回归测试。

## 一、已修复缺陷

### 1. 多用户模式下会话 CSRF 与工作区 CSRF 契约断裂（严重）

- 现象：登录后所有写请求被内层拒绝（403），前端只能读不能写。
- 根因：外层 `MultiApp` 签发会话 Cookie + `sessions.csrf_token`，内层 `App` 另有一个进程级 `App.CSRF`。
  `/session` 返回的是内层 token，浏览器拿它写请求，而 `fallback` 把请求原样转给内层路由，
  内层校验自己的 token → 必然失败。
- 修复：`dispatchWorkspace` 在完成外层会话认证后，把 `X-CSRF-Token` 改写为内层 workspace token 再转发；
  `/session` 改为返回**当前会话**的 `csrf_token`（`sessionCSRF`）。

### 2. 外层安全中间件缺少 CSRF 校验（安全缺口）

- 根因：CSRF 只在内层做，`/api/v1/admin/*` 等外层路由完全没有校验。
- 修复：`securityMiddleware` 对所有非 GET/HEAD/OPTIONS 请求强制 `validCSRF`（常量时间比较），
  仅豁免 `/api/v1/auth/login`（尚无会话）与 `/api/v1/shutdown`（仅 loopback 可用）。

### 3. 停用管理员无法删除

- 根因：唯一管理员保护只统计 `role='admin'`，把 `status='disabled'` 的也算进去。
- 修复：仅统计 `role='admin' AND status='active'`。

### 4. SQL 迁移执行器重复、无事务、版本记录缺失（结构紊乱）

- 根因：`store.go` 逐文件手写 001~009 分支，006 单独开事务，其余不开；005/007/008 未写 `schema_migrations`。
- 修复：`applyMigrations` 统一按文件名遍历 `migrations/*.sql`，每个迁移单事务执行；
  补齐 005/007/008 的版本记录（`INSERT OR IGNORE`）。

### 5. 存储故障被误报为「记录不存在」（逻辑歧义）

- 根因：`get[T]` 把 `store.Get` 的所有错误统一映射为 404。
- 修复：仅 `sql.ErrNoRows` → 404「记录不存在」，其余 → 500「读取记录失败」。

### 6. 重试任务时忽略任务列表读取错误

- `retryJob` 中 `store.List` 的 error 被丢弃，故障时表现为「没有任务可重试」。
- 修复：显式返回 500「读取任务失败」。

### 7. 采集列表异步竞态（前端）

- `Collections.load()` 旧请求晚返回会覆盖新筛选/分页结果，出现「列表与筛选不符」。
- 修复：请求序号 `loadSequence`，只有最新请求可写状态。

### 8. `Rewrites.tsx` 两处不可达代码造成歧义

- 草稿自动同步 effect 被 `if (selectedID) return;` 置于永不执行的分支（且前序守卫已要求 `selectedID` 为真）。
  该路径已由 `CreationWorkflow`（`/workflow/drafts/:scope`）接管，故移除死代码并注明原因，
  避免误判「草稿在同步」。
- 旧版内联编辑器（约 900 行）位于所有分支之后，实际不可达（空选择/回收站/加载中/已打开项目均已提前 return）。
  本次未删除：其 JSX 引用了大量仍在使用的 state/handler，删除会级联改动实时路径，
  在无版本控制的前提下风险大于收益。已加注释标注为「暂留、勿扩展」，建议后续单独提交移除。

## 二、新增回归测试

| 文件 | 覆盖点 |
| --- | --- |
| `internal/app/multiuser_csrf_test.go` | 会话 CSRF 可通过工作区写请求；无效 CSRF 对工作区与管理端均 403；停用管理员可删、最后一个启用管理员不可删 |
| `internal/app/app_errors_test.go` | 存储故障返回 500 而非 404 |
| `internal/store/store_test.go` | 9 个迁移全部记录；关闭重开数据保留；迁移重复执行不破坏数据 |
| `internal/app/workflow_prompts_test.go` | 补上会话 CSRF 头，适配新契约 |

## 三、验证结果

- `go test ./...`：全部通过（`internal/app` 84.0s、`internal/store` 4.3s，其余缓存命中）
- `go vet ./...`：无输出
- `tsc -b --force`：通过
- `vite build`：3220 modules，成功产出
- 前端 `test:logic` 14 个套件：全部 ok
- 采集 Python 测试 5 项、小程序 Node 测试 93 项、发布组件 `TestWorkbench`：通过

## 四、假设（已确认，2026-11-02）

以下 5 条已由负责人确认成立，作为当前实现的既定契约，后续改动不得在无新决策的前提下偏离。

1. **CSRF 豁免清单**：只有 `/api/v1/auth/login` 与 `/api/v1/shutdown` 可在无 token 时调用。
   后续新增 OAuth 回调等入口，需显式加入 `csrfExempt`，并同步更新 `multiuser_csrf_test.go`。
2. **登出需要 CSRF**：`/api/v1/auth/logout` **不**豁免。前端须在拿到 `/session` 后才可登出；
   首屏会话探测完成前点击登出返回 403 属预期行为。
3. **旧版内联编辑器**：确认其功能已被 `CreationWorkflow` 完全覆盖，当前代码路径完全不可达。
   本次保留（避免级联改动实时路径），标注为「暂留、勿扩展」；物理删除可另起一次独立提交，
   前提是删除后 `go test` / `tsc -b` / `test:logic` 全绿。
4. **`DraftSync` 及草稿状态条**：确认服务端草稿写入由 `/workflow/drafts/:scope` 接管，
   保留骨架但不重新接线；是否移除待新工作流稳定后另行决定。
5. **`preferredDraft`**：确认无 `edited_at` 的旧草稿一律视为本地更新（历史数据兼容），
   在服务端统一写入 `edited_at` 之前不得删除该分支。
