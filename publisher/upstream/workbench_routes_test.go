// Workbench fork: modified for local QR publishing (publisher/README.md).
package main

import (
	"net/http/httptest"
	"testing"
)

func TestWorkbenchEndpointIsolation(t *testing.T) {
	r := setupRoutes(&AppServer{authToken: "test-token"})
	for _, tc := range []struct {
		path, origin string
		code         int
	}{{"/api/v1/login/status", "", 401}, {"/api/v1/login/status", "https://example.com", 403}, {"/mcp", "", 404}, {"/health", "", 200}} {
		q := httptest.NewRequest("GET", tc.path, nil)
		q.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		if w.Code != tc.code {
			t.Fatal(tc.path, w.Code)
		}
	}
}
