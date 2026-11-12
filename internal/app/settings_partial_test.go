package app

import (
	"bytes"
	"net/http"
	"reflect"
	"testing"

	"xhs-workbench/internal/adapter"
	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/store"
)

func TestServiceSettingsPartialUpdatesPreserveOtherServicesAndSecrets(t *testing.T) {
	a := testApp(t)
	s := a.settings()
	sealed, err := adapter.Seal("fixture-only-service-key")
	if err != nil {
		t.Fatal(err)
	}
	s.Text.Secret, s.OCR.Secret, s.ASR.Secret = sealed, sealed, sealed
	if err := store.Put(a.Store.DB, "settings", "services", s); err != nil {
		t.Fatal(err)
	}
	request(t, a, "PUT", "/settings", map[string]any{"ocr": map[string]string{"base_url": "https://ocr.example.test/v1/", "model": " new-ocr ", "secret": ""}}, 200)
	after := a.settings()
	if !reflect.DeepEqual(after.Text, s.Text) || !reflect.DeepEqual(after.ASR, s.ASR) || after.OCR.Secret != sealed || after.OCR.Model != "new-ocr" || after.OCR.BaseURL != "https://ocr.example.test/v1" {
		t.Fatal("partial OCR save changed omitted service or discarded saved key")
	}
	request(t, a, "PUT", "/settings", map[string]any{"asr": map[string]string{"base_url": "wss://asr.example.test/stream", "model": "new-asr", "secret": "fixture-only-new-asr-key"}}, 200)
	next := a.settings()
	if !reflect.DeepEqual(next.OCR, after.OCR) || !reflect.DeepEqual(next.Text, after.Text) {
		t.Fatal("ASR update overwrote OCR or text settings")
	}
	plain, err := adapter.Unseal(next.ASR.Secret)
	if err != nil || plain != "fixture-only-new-asr-key" {
		t.Fatal("ASR secret did not round-trip")
	}
	request(t, a, "PUT", "/settings", map[string]any{"clear": []string{"ocr"}}, 200)
	cleared := a.settings()
	if cleared.OCR.Secret != "" || !reflect.DeepEqual(cleared.ASR, next.ASR) || !reflect.DeepEqual(cleared.Text, next.Text) {
		t.Fatal("clear affected another service")
	}
	raw := request(t, a, "GET", "/settings", nil, 200)
	for _, forbidden := range []string{sealed, next.ASR.Secret, "fixture-only-new-asr-key"} {
		if bytes.Contains(raw, []byte(forbidden)) {
			t.Fatal("settings response leaked a credential")
		}
	}
	var response struct {
		Services domain.Settings `json:"services"`
	}
	response = decode[struct {
		Services domain.Settings `json:"services"`
	}](t, raw)
	if response.Services.OCR.Configured || !response.Services.ASR.Configured || response.Services.ASR.Secret != "" {
		t.Fatal("masked configuration status is incorrect")
	}
}

func TestServiceSettingsInvalidCombinedUpdateIsAtomic(t *testing.T) {
	a := testApp(t)
	before := a.settings()
	request(t, a, "PUT", "/settings", map[string]any{"ocr": map[string]string{"base_url": "https://ocr.example.test/v1", "model": "changed"}, "asr": map[string]string{"base_url": "ftp://invalid.example.test", "model": "bad"}, "clear": []string{"ocr"}}, 400)
	if !reflect.DeepEqual(a.settings(), before) {
		t.Fatal("invalid update partially persisted services")
	}
}

func TestAdministratorCanSaveOnlyOneServiceThroughAdminEndpoint(t *testing.T) {
	m, token, csrf := newMultiUserFixture(t, "admin")
	before := m.Model.settings()
	r := multiUserRequest(t, m, http.MethodPut, "/admin/settings", token, csrf, map[string]any{"ocr": map[string]string{"base_url": "https://ocr.example.test/v1", "model": "admin-ocr"}})
	if r.Code != http.StatusOK {
		t.Fatalf("admin partial save returned %d", r.Code)
	}
	after := m.Model.settings()
	if after.OCR.Model != "admin-ocr" || !reflect.DeepEqual(after.ASR, before.ASR) || !reflect.DeepEqual(after.Text, before.Text) {
		t.Fatal("admin save did not preserve unrelated services")
	}
}
