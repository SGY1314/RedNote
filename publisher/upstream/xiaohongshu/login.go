// Workbench fork: modified for local QR publishing (publisher/README.md).
package xiaohongshu

import (
	"context"
	_ "embed"
	"errors"
	"github.com/go-rod/rod"
	"time"
)

//go:embed login_probe.js
var loginProbe string

type LoginAction struct{ page *rod.Page }

func NewLogin(page *rod.Page) *LoginAction { return &LoginAction{page: page} }

type CurrentUser struct {
	Nickname string `json:"nickname"`
	UserID   string `json:"userId"`
}
type LoginObservation struct {
	State    string `json:"state"`
	Nickname string `json:"nickname"`
	UserID   string `json:"userId"`
}

// ObserveLogin never navigates or waits for a CSS element. QR polling must keep
// the scanned page alive, including any official verification flow.
func (a *LoginAction) ObserveLogin(ctx context.Context) (LoginObservation, error) {
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	res, err := a.page.Context(probeCtx).Eval(loginProbe)
	if err != nil {
		return LoginObservation{}, errors.New("无法读取登录页面，请保持专用浏览器打开")
	}
	var state LoginObservation
	if err := res.Value.Unmarshal(&state); err != nil {
		return state, errors.New("无法识别登录页面状态")
	}
	return state, nil
}

func (a *LoginAction) navigate(ctx context.Context) error {
	p := a.page.Context(ctx)
	if err := p.Navigate("https://www.xiaohongshu.com/explore"); err != nil {
		return errors.New("无法打开小红书登录页面")
	}
	if err := p.WaitLoad(); err != nil {
		return errors.New("小红书登录页面加载未完成")
	}
	return nil
}
func (a *LoginAction) CheckLoginStatus(ctx context.Context) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := a.navigate(ctx); err != nil {
		return false, err
	}
	// Allow hydration instead of assuming state is ready one second after load.
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		state, err := a.ObserveLogin(ctx)
		if err == nil && state.State == "authenticated" {
			return true, nil
		}
		if err == nil && (state.State == "verification_required" || state.State == "expired") {
			return false, nil
		}
		// Logged-out pages with a real QR do not need the full hydration timeout.
		if els, e := a.page.Context(ctx).Elements(".login-container .qrcode-img"); e == nil && len(els) > 0 {
			if visible, e := els[0].Visible(); e == nil && visible {
				return false, nil
			}
		}
		select {
		case <-ctx.Done():
			return false, errors.New("登录状态核验超时，请在专用浏览器检查页面")
		case <-ticker.C:
		}
	}
}
func (a *LoginAction) CurrentUser(ctx context.Context) (*CurrentUser, error) {
	state, err := a.ObserveLogin(ctx)
	if err != nil {
		return nil, err
	}
	if state.State != "authenticated" || state.UserID == "" {
		return nil, errors.New("尚未核实当前登录账号")
	}
	return &CurrentUser{Nickname: state.Nickname, UserID: state.UserID}, nil
}
func (a *LoginAction) Login(ctx context.Context) error {
	if err := a.navigate(ctx); err != nil {
		return err
	}
	if !a.WaitForLogin(ctx) {
		return errors.New("登录未完成或已超时")
	}
	return nil
}
func (a *LoginAction) FetchQrcodeImage(ctx context.Context) (string, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if err := a.navigate(ctx); err != nil {
		return "", false, err
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		state, err := a.ObserveLogin(ctx)
		if err == nil && state.State == "authenticated" {
			return "", true, nil
		}
		els, err := a.page.Context(ctx).Elements(".login-container .qrcode-img")
		if err == nil && len(els) > 0 {
			visible, _ := els[0].Visible()
			src, e := els[0].Attribute("src")
			if visible && e == nil && src != nil && *src != "" {
				return *src, false, nil
			}
		}
		select {
		case <-ctx.Done():
			return "", false, errors.New("未读取到二维码，请检查小红书页面或网络后重试")
		case <-ticker.C:
		}
	}
}
func (a *LoginAction) WaitForLogin(ctx context.Context) bool {
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	for {
		state, err := a.ObserveLogin(ctx)
		if err == nil && state.State == "authenticated" {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
		}
	}
}
