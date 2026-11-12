package app

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestPublisherObservedLoginStatesForwarded(t *testing.T) {
	a := testApp(t)
	a.Config.PublisherURL = "http://127.0.0.1:18060"
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	for _, state := range []string{"waiting_scan", "verifying", "verification_required", "expired", "failed", "success"} {
		state := state
		http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
			if r.URL.Path != "/api/v1/login/status" {
				t.Fatal("unexpected request")
			}
			logged := "false"
			if state == "success" {
				logged = "true"
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"data":{"is_logged_in":` + logged + `,"state":"` + state + `","message":"状态提示","expires_at":"2026-10-16T00:30:00Z"}}`)), Header: make(http.Header)}, nil
		})
		v := decode[publisherAccount](t, request(t, a, "POST", "/publisher/status", nil, 200))
		if v.State != state || v.Message != "状态提示" || v.ExpiresAt == "" || v.LoggedIn != (state == "success") {
			t.Fatal("login state lost")
		}
	}
}
