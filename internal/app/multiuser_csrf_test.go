package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newMultiUserFixture(t *testing.T, role string) (*MultiApp, string, string) {
	t.Helper()
	m, err := NewMulti(Config{Listen: "127.0.0.1:8080", DataDir: t.TempDir(), WebDir: t.TempDir(), CollectorURL: "http://127.0.0.1:5556"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	var userID string
	if err := m.AuthDB.QueryRow("SELECT id FROM users WHERE role=? LIMIT 1", role).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	token, csrf, err := m.createSession(AuthUser{ID: userID}, "127.0.0.1", "test")
	if err != nil {
		t.Fatal(err)
	}
	return m, token, csrf
}

func multiUserRequest(t *testing.T, m *MultiApp, method, path, token, csrf string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, "http://127.0.0.1:8080/api/v1"+path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	out := httptest.NewRecorder()
	m.Router().ServeHTTP(out, req)
	return out
}

func TestMultiUserSessionCSRFWorksAcrossWorkspaceDispatch(t *testing.T) {
	m, token, csrf := newMultiUserFixture(t, "creator")
	session := multiUserRequest(t, m, http.MethodGet, "/session", token, "", nil)
	if session.Code != http.StatusOK {
		t.Fatal("session request failed:", session.Code, session.Body.String())
	}
	var payload struct {
		CSRF string `json:"csrf_token"`
	}
	if err := json.Unmarshal(session.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.CSRF != csrf {
		t.Fatal("workspace session did not return the authenticated session CSRF token")
	}
	created := multiUserRequest(t, m, http.MethodPost, "/rewrites", token, csrf, map[string]string{"name": "CSRF integration"})
	if created.Code != http.StatusCreated {
		t.Fatal("valid session CSRF rejected by workspace:", created.Code, created.Body.String())
	}
}

func TestAdminDeletionGuardOnlyProtectsActiveAdmins(t *testing.T) {
	m, token, csrf := newMultiUserFixture(t, "admin")
	disabledID := ID()
	if _, err := m.AuthDB.Exec(
		`INSERT INTO users(id,username,password_hash,display_name,role,status,created_at,note) VALUES(?,?,?,?,?,'disabled',?,'')`,
		disabledID, "disabled-admin", "unused", "停用管理员", "admin", Now(),
	); err != nil {
		t.Fatal(err)
	}
	response := multiUserRequest(t, m, http.MethodDelete, "/admin/users/"+disabledID, token, csrf, nil)
	if response.Code != http.StatusOK {
		t.Fatal("disabled administrator could not be deleted:", response.Code, response.Body.String())
	}

	m, token, csrf = newMultiUserFixture(t, "admin")
	var currentID string
	if err := m.AuthDB.QueryRow("SELECT id FROM users WHERE role='admin' AND status='active' LIMIT 1").Scan(&currentID); err != nil {
		t.Fatal(err)
	}
	response = multiUserRequest(t, m, http.MethodDelete, "/admin/users/"+currentID, token, csrf, nil)
	if response.Code != http.StatusBadRequest {
		t.Fatal("last active administrator was deletable:", response.Code, response.Body.String())
	}
}

func TestMultiUserWriteRequestsRejectInvalidCSRF(t *testing.T) {
	for _, test := range []struct {
		name   string
		role   string
		method string
		path   string
		body   any
	}{
		{name: "workspace", role: "creator", method: http.MethodPost, path: "/rewrites", body: map[string]string{"name": "must not be created"}},
		{name: "admin", role: "admin", method: http.MethodPut, path: "/admin/billing", body: map[string]float64{"price_per_1k": 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			m, token, _ := newMultiUserFixture(t, test.role)
			response := multiUserRequest(t, m, test.method, test.path, token, "invalid-csrf", test.body)
			if response.Code != http.StatusForbidden {
				t.Fatal("invalid CSRF accepted:", response.Code, response.Body.String())
			}
		})
	}
}
