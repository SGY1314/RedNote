package app

import (
	"net/http"
	"testing"
)

func TestCreatorAndOperatorCannotAccessAdministration(t *testing.T) {
	for _, role := range []string{"creator", "operator"} {
		t.Run(role, func(t *testing.T) {
			m, token, csrf := newMultiUserFixture(t, role)
			for _, target := range []struct{ method, path string }{
				{http.MethodGet, "/admin/overview"},
				{http.MethodGet, "/admin/users"},
				{http.MethodPost, "/admin/users"},
				{http.MethodPatch, "/admin/users/administrator"},
				{http.MethodDelete, "/admin/users/administrator"},
				{http.MethodPost, "/admin/users/administrator/password"},
				{http.MethodGet, "/admin/settings"},
				{http.MethodPut, "/admin/settings"},
				{http.MethodPost, "/admin/settings/test/ocr"},
				{http.MethodPost, "/admin/settings/test/asr"},
				{http.MethodGet, "/admin/models/video"},
				{http.MethodPut, "/admin/models/video/model"},
				{http.MethodDelete, "/admin/models/video/model"},
				{http.MethodPost, "/admin/models/video/model/test"},
				{http.MethodPut, "/admin/billing"},
				{http.MethodGet, "/admin/prompt-presets"},
				{http.MethodPost, "/admin/prompt-presets"},
			} {
				response := multiUserRequest(t, m, target.method, target.path, token, csrf, map[string]string{"display_name": "must remain unchanged"})
				if response.Code != http.StatusForbidden {
					t.Fatalf("%s %s returned %d, expected forbidden", target.method, target.path, response.Code)
				}
			}
		})
	}
}

func TestAdministratorRetainsUserManagementAuthority(t *testing.T) {
	m, token, csrf := newMultiUserFixture(t, "admin")
	var creatorID string
	if err := m.AuthDB.QueryRow("SELECT id FROM users WHERE role='creator' LIMIT 1").Scan(&creatorID); err != nil {
		t.Fatal(err)
	}
	response := multiUserRequest(t, m, http.MethodPatch, "/admin/users/"+creatorID, token, csrf, map[string]string{"note": "managed by administrator"})
	if response.Code != http.StatusOK {
		t.Fatalf("administrator could not update user: %d", response.Code)
	}
	var note string
	if err := m.AuthDB.QueryRow("SELECT note FROM users WHERE id=?", creatorID).Scan(&note); err != nil {
		t.Fatal(err)
	}
	if note != "managed by administrator" {
		t.Fatal("administrator change was not persisted")
	}
}
