// Workbench fork: modified for local QR publishing (publisher/README.md).
package main

import (
	"sync"
	"time"
)

// loginSessions 管理「已发出二维码、还在等扫码」的登录会话。
//
// 取一次二维码就要留一个浏览器活着等扫码，否则检测不到登录、也存不了 cookie。
// 但没有任何东西拦着重复调用，于是每调一次就多一个浏览器活到超时为止。
// 这里的约束是：同一时刻只保留一个待扫码会话，开新的就把旧的关掉。
type loginSessions struct {
	mu      sync.Mutex
	seq     uint64
	cancel  func()
	status  LoginStatusResponse
	updated time.Time
}

// start 结束上一个待扫码会话（如果有），登记新的，返回本次会话的序号。
// 序号用于 finish 判断自己是不是仍然是当前会话。
func (l *loginSessions) start(cancel func()) uint64 {
	l.mu.Lock()
	prev := l.cancel
	l.seq++
	seq := l.seq
	l.cancel = cancel
	l.status = LoginStatusResponse{State: "waiting_scan", ExpiresAt: time.Now().Add(4 * time.Minute).UTC().Format(time.RFC3339)}
	l.updated = time.Now()
	l.mu.Unlock()

	// 放到锁外调用：取消动作会触发对方 goroutine 的收尾，避免相互等待
	if prev != nil {
		prev()
	}
	return seq
}

// finish 会话自己结束时清理登记。仅当它仍是当前会话才清，
// 否则会把后来者的登记抹掉，导致后来者永远不会被 start 关闭。
func (l *loginSessions) finish(seq uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.seq == seq {
		l.cancel = nil
	}
}

// snapshot returns the actual observed QR state rather than a hardcoded false.
// Success is cached briefly; later checks revalidate the persisted session.
func (l *loginSessions) snapshot() *LoginStatusResponse {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.status.State == "" || (l.cancel == nil && l.status.IsLoggedIn && time.Since(l.updated) > 30*time.Second) {
		return nil
	}
	v := l.status
	return &v
}
func (l *loginSessions) update(seq uint64, state, message string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.seq != seq {
		return
	}
	l.status.State, l.status.Message = state, message
	l.updated = time.Now()
}

// Persistence and identity publication share the generation guard. A stale QR
// must never overwrite credentials after logout or a newer login starts.
func (l *loginSessions) commit(seq uint64, user LoginStatusResponse, save func() error) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.seq != seq || l.cancel == nil || user.UserID == "" {
		return false
	}
	if err := save(); err != nil {
		l.status = LoginStatusResponse{State: "failed", Message: "扫码已确认，但登录信息保存失败；请检查文件夹写入权限后重新连接"}
		l.updated = time.Now()
		return false
	}
	user.IsLoggedIn, user.State = true, "success"
	l.status, l.updated = user, time.Now()
	return true
}
