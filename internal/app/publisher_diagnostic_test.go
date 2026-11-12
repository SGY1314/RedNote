package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestPublisherSafeDiagnostic(t *testing.T) {
	a := testApp(t)
	a.Config.PublisherURL = "http://127.0.0.1:18060"
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	for _, code := range []string{"XHS_PUBLISH_verification", "XHS_PUBLISH_button_covered", "UNTRUSTED_CODE"} {
		http.DefaultTransport = rewriteTransport(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader(`{"code":"` + code + `","details":"private-cookie-value","error":"private-cookie-value"}`)), Header: make(http.Header)}, nil
		})
		err := a.publisherCall(context.Background(), "POST", "/api/v1/publish", nil, nil)
		if err == nil || strings.Contains(err.Error(), "private-cookie") {
			t.Fatal("unsafe or missing error", err)
		}
		var diagnostic *publisherDiagnosticError
		if errors.As(err, &diagnostic) != (code != "UNTRUSTED_CODE") {
			t.Fatal("diagnostic allowlist failed")
		}
	}
}
