package main

import (
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGatewayAuthenticationAndOriginBoundary(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("test-pass"), bcrypt.MinCost)
	calls := 0
	proxy := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-Forwarded-For") != "" {
			t.Error("credentials or spoofed forwarding header reached upstream")
		}
		if r.Header.Get("Range") != "bytes=0-9" {
			t.Error("media range stripped")
		}
		w.WriteHeader(206)
	})
	handler := gatewayHandler(&credentials{Username: "owner", PasswordHash: string(hash)}, "https://example.test:8443", proxy)
	for _, tc := range []struct {
		name, user, pass, origin, site string
		code                           int
	}{
		{"anonymous", "", "", "", "", 401}, {"wrong", "owner", "wrong", "", "", 401},
		{"cross-origin", "owner", "test-pass", "https://evil.test", "", 403},
		{"cross-site", "owner", "test-pass", "", "cross-site", 403},
		{"valid", "owner", "test-pass", "https://example.test:8443", "same-origin", 206},
		{"cached", "owner", "test-pass", "", "same-origin", 206},
		{"cache-not-bypass", "owner", "wrong", "", "", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "https://example.test:8443/api/v1/assets/a/file", nil)
			r.RemoteAddr = "127.0.0.1:1234"
			if tc.user != "" {
				r.SetBasicAuth(tc.user, tc.pass)
			}
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Sec-Fetch-Site", tc.site)
			r.Header.Set("Range", "bytes=0-9")
			r.Header.Set("X-Forwarded-For", "spoofed")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.code {
				t.Fatalf("got %d expected %d", w.Code, tc.code)
			}
		})
	}
	if calls != 2 {
		t.Fatal("unauthorized request proxied", calls)
	}
	for i := 0; i < 15; i++ {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = "127.0.0.2:1"
		r.SetBasicAuth("owner", "bad")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if i >= 12 && w.Code != 429 {
			t.Fatal("brute force not limited")
		}
	}
}
