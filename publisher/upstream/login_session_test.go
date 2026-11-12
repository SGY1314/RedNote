// Workbench fork: modified for local QR publishing (publisher/README.md).
package main

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestLoginSessions 固定「同一时刻只保留一个待扫码会话」这条约束。
//
// 这是浏览器不再堆积的依据：每个待扫码会话都占着一个浏览器活到超时为止，
// 只要新会话没能关掉旧的，进程就会累积。
func TestLoginSessions(t *testing.T) {
	t.Run("开新会话会关掉上一个", func(t *testing.T) {
		var l loginSessions
		closed := 0

		l.start(func() { closed++ })
		assert.Equal(t, 0, closed, "第一个会话不该被关")

		l.start(func() {})
		assert.Equal(t, 1, closed, "开第二个时应关掉第一个")
	})

	t.Run("第一个会话无需关闭任何东西", func(t *testing.T) {
		var l loginSessions
		assert.NotPanics(t, func() { l.start(func() {}) })
	})

	t.Run("会话结束后不会再被关第二次", func(t *testing.T) {
		var l loginSessions
		closed := 0

		seq := l.start(func() { closed++ })
		l.finish(seq)

		l.start(func() {})
		assert.Equal(t, 0, closed, "已结束的会话不该再被关闭")
	})

	t.Run("旧会话的收尾不会顶掉新会话", func(t *testing.T) {
		var l loginSessions
		newClosed := 0

		oldSeq := l.start(func() {})
		l.start(func() { newClosed++ }) // 新会话上位

		// 旧会话此时才走完收尾，它必须认出自己已不是当前会话
		l.finish(oldSeq)

		// 再开一个：如果上一步误清了登记，新会话就永远关不掉了
		l.start(func() {})
		assert.Equal(t, 1, newClosed, "新会话仍应被后来者关闭")
	})

	t.Run("并发开会话时每个序号唯一", func(t *testing.T) {
		var l loginSessions
		const n = 50

		var mu sync.Mutex
		seen := make(map[uint64]bool, n)

		var wg sync.WaitGroup
		for range n {
			wg.Add(1)
			go func() {
				defer wg.Done()
				seq := l.start(func() {})
				mu.Lock()
				seen[seq] = true
				mu.Unlock()
			}()
		}
		wg.Wait()

		assert.Len(t, seen, n, "序号必须唯一，否则 finish 会误清别人的登记")
	})
}

func TestLoginObservedStatesAndDurableSuccess(t *testing.T) {
	var l loginSessions
	seq := l.start(func() {})
	assert.Equal(t, "waiting_scan", l.snapshot().State)
	l.update(seq, "verification_required", "请完成验证")
	assert.False(t, l.snapshot().IsLoggedIn)
	assert.Equal(t, "verification_required", l.snapshot().State)
	saves := 0
	user := LoginStatusResponse{UserID: "0123456789abcdef01234567", Username: "测试账号"}
	assert.True(t, l.commit(seq, user, func() error { saves++; return nil }))
	l.finish(seq)
	assert.Equal(t, 1, saves)
	assert.True(t, l.snapshot().IsLoggedIn)
	assert.Equal(t, user.UserID, l.snapshot().UserID)
	l.updated = time.Now().Add(-31 * time.Second)
	assert.Nil(t, l.snapshot(), "cached success must be reverified")
}
func TestLoginSaveFailureIsNotSuccess(t *testing.T) {
	var l loginSessions
	seq := l.start(func() {})
	assert.False(t, l.commit(seq, LoginStatusResponse{UserID: "0123456789abcdef01234567"}, func() error { return errors.New("private error details") }))
	l.finish(seq)
	v := l.snapshot()
	assert.Equal(t, "failed", v.State)
	assert.False(t, v.IsLoggedIn)
	assert.NotContains(t, v.Message, "private")
	assert.Contains(t, v.Message, "保存失败")
}
func TestLoginOldCallbacksCannotReplaceNewOrLoggedOutSession(t *testing.T) {
	s := NewXiaohongshuService()
	old := s.logins.start(func() {})
	newer := s.logins.start(func() {})
	saves := 0
	persist := func() error { saves++; return nil }
	user := LoginStatusResponse{UserID: "0123456789abcdef01234567"}
	s.logins.update(old, "expired", "旧二维码过期")
	assert.False(t, s.logins.commit(old, user, persist))
	assert.Equal(t, "waiting_scan", s.logins.snapshot().State)
	assert.False(t, s.logins.commit(newer, LoginStatusResponse{}, persist), "identity is required")
	s.stopLogin()
	assert.False(t, s.logins.commit(newer, user, persist))
	assert.Nil(t, s.logins.snapshot())
	assert.Equal(t, 0, saves)
}
func TestLoginExpiryRetainsReason(t *testing.T) {
	var l loginSessions
	seq := l.start(func() {})
	l.update(seq, "expired", "本次扫码已超时")
	l.finish(seq)
	assert.Equal(t, "expired", l.snapshot().State)
	assert.False(t, l.snapshot().IsLoggedIn)
}
