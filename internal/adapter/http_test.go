package adapter

import (
	"net"
	"net/http"
	"net/url"
	"testing"
)

func TestDownloadBoundary(t *testing.T) {
	for _, u := range []string{"http://127.0.0.1/a", "file:///C:/secret", "https://xhscdn.com.evil.test/a", "https://user:pass@xhscdn.com/a", "https://xhscdn.com:999/a"} {
		if AllowedURL(u) == nil {
			t.Fatal("unsafe URL accepted", u)
		}
	}
	if e := AllowedURL("https://sns-webpic-qc.xhscdn.com/a"); e != nil {
		t.Fatal(e)
	}
	for _, ip := range []string{"127.0.0.1", "::1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "fc00::1", "100.100.100.200"} {
		if PublicIP(net.ParseIP(ip)) {
			t.Fatal("unsafe IP accepted", ip)
		}
	}
}

func TestDouyinCollectedCDNBoundary(t *testing.T) {
	client := MediaClient()
	for _, raw := range []string{
		"https://v5-hl-mly-ov.zjcdn.com/video/?sign=SIGNED",
		"https://V5-HL-MLY-OV.ZJCDN.COM:443/video/",
	} {
		if err := AllowedURL(raw); err != nil {
			t.Fatal("collected video rejected", err)
		}
		u, _ := url.Parse(raw)
		if err := client.CheckRedirect(&http.Request{URL: u}, nil); err != nil {
			t.Fatal("valid media redirect rejected", err)
		}
	}
	for _, raw := range []string{
		"http://v5-hl-mly-ov.zjcdn.com/video/",
		"https://v5-hl-mly-ov.zjcdn.com:80/video/",
		"https://v5-hl-mly-ov.zjcdn.com:8443/video/",
		"https://user:pass@v5-hl-mly-ov.zjcdn.com/video/",
		"https://v5-hl-mly-ov.zjcdn.com.evil.test/video/",
		"https://evil.v5-hl-mly-ov.zjcdn.com/video/",
		"https://other.zjcdn.com/video/",
		"https://zjcdn.com/video/",
		"http://127.0.0.1/video/",
	} {
		if AllowedURL(raw) == nil {
			t.Fatal("unsafe video URL accepted", raw)
		}
		u, _ := url.Parse(raw)
		if client.CheckRedirect(&http.Request{URL: u}, nil) == nil {
			t.Fatal("unsafe redirect accepted", raw)
		}
	}
}
