// Workbench fork: modified for local QR publishing (publisher/README.md).
package browser

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/sirupsen/logrus"
	"github.com/xpzouying/xiaohongshu-mcp/cookies"
)

type browserConfig struct {
	// fingerprintSeed 固定指纹 seed；>0 时钉死，同账号每次同一套指纹。0 = 每次随机。
	fingerprintSeed int
	// proxy 代理地址；非空时启用。
	proxy string
}

type Option func(*browserConfig)

// WithProxy 设置代理（http/https/socks5）。空字符串视为不启用。
func WithProxy(proxy string) Option {
	return func(c *browserConfig) {
		c.proxy = proxy
	}
}

// WithFingerprintSeed 设置 seed，seed<=0 视为未设，回退每次随机。
func WithFingerprintSeed(seed int) Option {
	return func(c *browserConfig) {
		c.fingerprintSeed = seed
	}
}

// maskProxyCredentials masks username and password in proxy URL for safe logging.
func maskProxyCredentials(proxyURL string) string {
	u, err := url.Parse(proxyURL)
	if err != nil || u.User == nil {
		return proxyURL
	}
	cred := "***"
	if _, hasPassword := u.User.Password(); hasPassword {
		cred = "***:***"
	}
	// 直接在原串替换 userinfo，避免 url.String() 把 * 编码成 %2A（日志变乱码）。
	return strings.Replace(proxyURL, u.User.String()+"@", cred+"@", 1)
}

// Workbench uses installed Chrome/Edge directly, with its normal sandbox and
// a disposable profile. No injected stealth or separate leakless executable.
type Browser struct {
	browser  *rod.Browser
	launcher *launcher.Launcher
}

func (b *Browser) NewPage() *rod.Page { return b.browser.MustPage() }
func (b *Browser) Close() {
	_ = b.browser.Close()
	b.launcher.Kill()
	b.launcher.Cleanup()
}

func NewBrowser(headless bool, options ...Option) *Browser {
	cfg := &browserConfig{}
	for _, opt := range options {
		opt(cfg)
	}

	binPath, err := EnsureBrowser()
	if err != nil {
		panic(fmt.Sprintf("本机浏览器不可用: %v", err))
	}
	l := launcher.New().Bin(binPath).Headless(headless).Leakless(false).NoSandbox(false).Set("lang", "zh-CN")
	if cfg.proxy != "" {
		l.Proxy(cfg.proxy)
		logrus.Infof("Using proxy: %s", maskProxyCredentials(cfg.proxy))
	}
	u, err := l.Launch()
	if err != nil {
		panic(fmt.Sprintf("启动本机浏览器失败: %v", err))
	}
	r := rod.New().ControlURL(u)
	if err = r.Connect(); err != nil {
		l.Kill()
		l.Cleanup()
		panic("连接本机浏览器失败")
	}
	b := &Browser{browser: r, launcher: l}
	if data, err := cookies.NewLoadCookie(cookies.GetCookiesFilePath()).LoadCookies(); err == nil {
		var cks []*proto.NetworkCookie
		if json.Unmarshal(data, &cks) != nil {
			b.Close()
			panic("登录信息格式错误，请重新扫码")
		}
		if err = r.SetCookies(proto.CookiesToParams(cks)); err != nil {
			b.Close()
			panic("无法加载登录信息，请重新扫码")
		}
	}
	return b
}
