package handoffcloud

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/workflow"
)

type harness struct {
	server    *Server
	now       atomic.Int64
	data, key string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{data: t.TempDir(), key: strings.Repeat("test-cloud-key-", 4)}
	h.now.Store(time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC).UnixNano())
	h.restart(t)
	return h
}

func (h *harness) restart(t *testing.T) {
	t.Helper()
	var err error
	h.server, err = New(Config{DataDir: h.data, PublicURL: "http://127.0.0.1:8083", ControlKey: h.key, Now: func() time.Time { return time.Unix(0, h.now.Load()) }})
	if err != nil {
		t.Fatal(err)
	}
}

func request(handler http.Handler, method, path, credential, contentType string, body io.Reader) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, body)
	if credential != "" {
		r.Header.Set("Authorization", "Bearer "+credential)
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func decode[T any](t *testing.T, response *httptest.ResponseRecorder, status int) T {
	t.Helper()
	if response.Code != status {
		t.Fatalf("HTTP %d, want %d: %s", response.Code, status, response.Body.String())
	}
	var data T
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	return data
}

func fixture() (domain.MiniappHandoffSnapshot, []byte) {
	var data bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 2, 3))
	picture.Set(0, 0, color.RGBA{R: 120, A: 255})
	_ = png.Encode(&data, picture)
	sum := sha256.Sum256(data.Bytes())
	snapshot := domain.MiniappHandoffSnapshot{PublicationID: "publication-a", VersionID: "version-confirmed", Title: "真实资源网络联调", Body: "A frozen draft\n第二行", Topics: []string{"创作"}, Media: []domain.MiniappHandoffMedia{{AssetID: "asset-a", Kind: "image", MIME: "image/png", SHA256: hex.EncodeToString(sum[:]), PreviewURL: "/api/v1/assets/asset-a/file", Width: 2, Height: 3, Size: int64(data.Len())}}}
	snapshot.Fingerprint = workflow.HandoffSnapshotFingerprint(snapshot)
	return snapshot, data.Bytes()
}

func multipartRequest(t *testing.T, h *harness, snapshot domain.MiniappHandoffSnapshot, data []byte, extra map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	manifest := map[string]any{"snapshot": snapshot}
	for key, value := range extra {
		manifest[key] = value
	}
	encoded, _ := json.Marshal(manifest)
	field, _ := writer.CreateFormField("manifest")
	_, _ = field.Write(encoded)
	file, _ := writer.CreateFormFile("asset_"+snapshot.Media[0].AssetID, "../../ignored.png")
	_, _ = file.Write(data)
	_ = writer.Close()
	return request(h.server.Handler(), "POST", "/control/sessions", h.key, writer.FormDataContentType(), &body)
}

func (h *harness) create(t *testing.T) (CreateResponse, []byte) {
	t.Helper()
	snapshot, data := fixture()
	return decode[CreateResponse](t, multipartRequest(t, h, snapshot, data, nil), 201), data
}

func (h *harness) open(t *testing.T, created CreateResponse) ReceiverResponse {
	t.Helper()
	encoded, _ := json.Marshal(map[string]string{"ticket": created.Ticket})
	return decode[ReceiverResponse](t, request(h.server.Handler(), "POST", "/v1/development/open", "", "application/json", bytes.NewReader(encoded)), 200)
}

func TestCloudFrozenResourceLifecycleAndRestart(t *testing.T) {
	h := newHarness(t)
	created, bytesExpected := h.create(t)
	if len(created.Ticket) != 32 || created.State != "created" || !strings.Contains(created.LaunchPath, created.Ticket) || !strings.Contains(created.BrowserURL, "/receive?ticket=") {
		t.Fatal("invalid creation contract")
	}
	metadata, err := os.ReadFile(filepath.Join(h.server.directory(created.ID), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(metadata, []byte(created.Ticket)) {
		t.Fatal("raw ticket persisted")
	}
	read := request(h.server.Handler(), "GET", "/control/sessions/"+created.ID, h.key, "", nil)
	if read.Code != 200 || strings.Contains(read.Body.String(), `"ticket"`) || strings.Contains(read.Body.String(), `"browser_url"`) {
		t.Fatal("create-only secrets leaked")
	}
	opened := h.open(t, created)
	if opened.Envelope.State != "scanned" || len(opened.ReceiverToken) != 32 {
		t.Fatal("receiver did not bind")
	}
	mediaURL := opened.Envelope.Snapshot.Media[0].PreviewURL
	media := request(h.server.Handler(), "GET", mediaURL, "", "", nil)
	if media.Code != 200 || !bytes.Equal(media.Body.Bytes(), bytesExpected) || media.Header().Get("Content-Disposition") != "inline" || media.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("media not frozen: %d", media.Code)
	}
	if !strings.Contains(media.Header().Get("Cache-Control"), "no-store") || media.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("media security headers missing")
	}
	h.restart(t)
	for _, step := range []struct{ path, state string }{{"claim", "claimed"}, {"editor", "editor_opened"}} {
		result := decode[ReceiverResponse](t, request(h.server.Handler(), "POST", "/v1/development/"+step.path, opened.ReceiverToken, "application/json", strings.NewReader("{}")), 200)
		if result.Envelope.State != step.state || result.ReceiverToken != "" || result.Envelope.Snapshot.Fingerprint != created.Snapshot.Fingerprint {
			t.Fatal("development state or snapshot changed")
		}
	}
	metadata, _ = os.ReadFile(filepath.Join(h.server.directory(created.ID), "state.json"))
	if bytes.Contains(metadata, []byte(opened.ReceiverToken)) {
		t.Fatal("raw receiver token persisted")
	}
	cancelled := decode[domain.MiniappHandoffSession](t, request(h.server.Handler(), "POST", "/control/sessions/"+created.ID+"/cancel", h.key, "application/json", strings.NewReader("{}")), 200)
	if cancelled.State != "cancelled" {
		t.Fatal("cancel failed")
	}
	for _, response := range []*httptest.ResponseRecorder{request(h.server.Handler(), "GET", "/v1/development/session", opened.ReceiverToken, "", nil), request(h.server.Handler(), "GET", mediaURL, "", "", nil)} {
		if response.Code != 410 || strings.Contains(response.Body.String(), created.Snapshot.Title) {
			t.Fatal("cancelled payload remained accessible")
		}
	}
	if err := h.server.PruneExpired(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(h.server.mediaPath(created.ID, "asset-a")); !os.IsNotExist(err) {
		t.Fatal("revoked media was retained")
	}
}

func TestCloudAuthenticationTicketReplayAndStrictPayloads(t *testing.T) {
	h := newHarness(t)
	created, _ := h.create(t)
	opened := h.open(t, created)
	for _, test := range []struct {
		method, path, key, body string
		status                  int
	}{
		{"GET", "/control/sessions/" + created.ID, "", "", 401},
		{"GET", "/control/sessions/" + created.ID, opened.ReceiverToken, "", 401},
		{"GET", "/v1/development/session", h.key, "", 401},
		{"POST", "/v1/development/open", "", `{"ticket":"` + created.Ticket + `"}`, 409},
		{"POST", "/v1/development/open", "", `{"ticket":"` + created.Ticket + `","openid":"forged"}`, 400},
		{"POST", "/v1/development/editor", opened.ReceiverToken, `{}`, 409},
		{"POST", "/v1/development/claim", opened.ReceiverToken, `{"published":true}`, 400},
		{"POST", "/v1/development/claim", opened.ReceiverToken, `{} {}`, 400},
		{"GET", "/v1/media/" + created.ID + "/asset-a?key=" + opened.ReceiverToken, "", "", 401},
		{"GET", "/api/v1/accounts", h.key, "", 404},
	} {
		response := request(h.server.Handler(), test.method, test.path, test.key, "application/json", strings.NewReader(test.body))
		if response.Code != test.status {
			t.Errorf("%s %s: %d want %d: %s", test.method, test.path, response.Code, test.status, response.Body.String())
		}
	}
	wrongOrigin := httptest.NewRequest("GET", "/health", nil)
	wrongOrigin.Header.Set("Origin", "https://attacker.invalid")
	response := httptest.NewRecorder()
	h.server.Handler().ServeHTTP(response, wrongOrigin)
	if response.Code != 403 || response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("cross origin accepted")
	}
	for _, path := range []string{"/control/sessions/" + created.ID, "/%63ontrol/sessions/" + created.ID, "/control"} {
		if got := request(h.server.PublicHandler(), "GET", path, h.key, "", nil); got.Code != 404 {
			t.Fatalf("public listener exposed control: %s %d", path, got.Code)
		}
	}
}
