// Workbench fork: modified for local QR publishing (publisher/README.md).
package main

import (
	"context"
	"fmt"
	"github.com/go-rod/rod"
	"github.com/xpzouying/xiaohongshu-mcp/xiaohongshu"
)

func (s *XiaohongshuService) stopLogin() {
	s.logins.mu.Lock()
	defer s.logins.mu.Unlock()
	s.logins.seq++
	s.logins.status = LoginStatusResponse{}
	if s.logins.cancel != nil {
		s.logins.cancel()
		s.logins.cancel = nil
	}
}
func verifyPublishingAccount(ctx context.Context, page *rod.Page, expected string) error {
	login := xiaohongshu.NewLogin(page)
	ok, err := login.CheckLoginStatus(ctx)
	if err != nil || !ok {
		return fmt.Errorf("账号登录失效")
	}
	user, err := login.CurrentUser(ctx)
	if err != nil || user.UserID == "" || user.UserID != expected {
		return fmt.Errorf("发布账号不匹配")
	}
	return nil
}
