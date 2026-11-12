package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFrontendResourcesNeverFallBackToHTML(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "assets"), 0700)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>Workbench</title>"), 0600)
	os.WriteFile(filepath.Join(dir, "assets", "Rewrites-abcdefgh.js"), []byte("export default 'current'"), 0600)
	a := testApp(t)
	a.Config.WebDir = dir
	m, err := NewMulti(Config{DataDir: t.TempDir(), WebDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	for name, router := range map[string]http.Handler{"single": a.Router(), "multi": m.Router()} {
		t.Run(name, func(t *testing.T) {
			for _, path := range []string{"/", "/index.html", "/admin/login"} {
				req := httptest.NewRequest("GET", "http://127.0.0.1:8080"+path, nil)
				req.Header.Set("If-Modified-Since", "Fri, 31 Dec 2099 23:59:59 GMT")
				response := httptest.NewRecorder()
				router.ServeHTTP(response, req)
				if path == "/index.html" && response.Code == http.StatusMovedPermanently && response.Header().Get("Cache-Control") == "no-store" && response.Header().Get("Location") == "./" {
					continue
				}
				if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), "<!doctype html>") {
					t.Fatal("entry page must refresh without a stale conditional response", path, response.Code)
				}
			}
			for _, path := range []string{"/assets/missing-old.js", "/assets/missing-old.css", "/favicon.ico"} {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8080"+path, nil))
				if response.Code != 404 || strings.Contains(response.Body.String(), "<!doctype html>") || response.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("missing module must not be an HTML success", path, response.Code)
				}
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8080/assets/Rewrites-abcdefgh.js", nil))
			if response.Code != 200 || !strings.Contains(response.Header().Get("Content-Type"), "javascript") || !strings.Contains(response.Header().Get("Cache-Control"), "immutable") {
				t.Fatal("hashed module cache policy or MIME incorrect", response.Code, response.Header())
			}
		})
	}
}
