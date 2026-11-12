package handoffcloud

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/workflow"
)

func TestCloudConcurrentOpenIsSingleUse(t *testing.T) {
	h := newHarness(t)
	created, _ := h.create(t)
	var successes atomic.Int32
	var failures atomic.Int32
	var wait sync.WaitGroup
	for range 24 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			encoded, _ := json.Marshal(map[string]string{"ticket": created.Ticket})
			response := request(h.server.Handler(), "POST", "/v1/development/open", "", "application/json", bytes.NewReader(encoded))
			if response.Code == 200 {
				successes.Add(1)
			} else if response.Code == 409 {
				failures.Add(1)
			}
		}()
	}
	wait.Wait()
	if successes.Load() != 1 || failures.Load() != 23 {
		t.Fatalf("ticket was not atomic: %d accepted, %d rejected", successes.Load(), failures.Load())
	}
	h.restart(t)
	encoded, _ := json.Marshal(map[string]string{"ticket": created.Ticket})
	if response := request(h.server.Handler(), "POST", "/v1/development/open", "", "application/json", bytes.NewReader(encoded)); response.Code != 409 {
		t.Fatal("ticket replay after restart accepted")
	}
}

func TestCloudExpiryAndSourceExpiryClamping(t *testing.T) {
	h := newHarness(t)
	snapshot, data := fixture()
	deadline := time.Unix(0, h.now.Load()).Add(35 * time.Second)
	created := decode[CreateResponse](t, multipartRequest(t, h, snapshot, data, map[string]any{"expires_at": deadline.Format(time.RFC3339Nano)}), 201)
	cloudDeadline, _ := time.Parse(time.RFC3339Nano, created.ExpiresAt)
	if !cloudDeadline.Equal(deadline) {
		t.Fatal("cloud expiry extended the source session")
	}
	opened := h.open(t, created)
	h.now.Add(int64(36 * time.Second))
	for _, response := range []*httptest.ResponseRecorder{
		request(h.server.Handler(), "GET", "/v1/development/session", opened.ReceiverToken, "", nil),
		request(h.server.Handler(), "GET", opened.Envelope.Snapshot.Media[0].PreviewURL, "", "", nil),
		request(h.server.Handler(), "POST", "/v1/development/claim", opened.ReceiverToken, "application/json", strings.NewReader("{}")),
	} {
		if response.Code != 410 || strings.Contains(response.Body.String(), snapshot.Body) {
			t.Fatal("expired resources remained readable")
		}
	}
	read := decode[domain.MiniappHandoffSession](t, request(h.server.Handler(), "GET", "/control/sessions/"+created.ID, h.key, "", nil), 200)
	if read.State != "expired" {
		t.Fatal("desktop did not observe expiry")
	}
	if response := multipartRequest(t, h, snapshot, data, map[string]any{"expires_at": deadline.Format(time.RFC3339Nano)}); response.Code != 410 {
		t.Fatal("expired source accepted")
	}
	h.restart(t)
	if _, err := os.Stat(h.server.mediaPath(created.ID, "asset-a")); !os.IsNotExist(err) {
		t.Fatal("expired media not pruned on startup")
	}
	long := decode[CreateResponse](t, multipartRequest(t, h, snapshot, data, map[string]any{"expires_at": time.Unix(0, h.now.Load()).Add(time.Hour).Format(time.RFC3339Nano)}), 201)
	longEnd, _ := time.Parse(time.RFC3339Nano, long.ExpiresAt)
	if longEnd.Sub(time.Unix(0, h.now.Load())) > 10*time.Minute {
		t.Fatal("TTL extension allowed")
	}
}

func TestCloudUploadValidationAndCopiedFileIntegrity(t *testing.T) {
	for _, scenario := range []string{"wrong_hash", "wrong_size", "wrong_mime", "wrong_dimensions", "unsafe_asset", "external_preview", "unknown_manifest", "wrong_format", "oversize_image", "oversize_video"} {
		t.Run(scenario, func(t *testing.T) {
			h := newHarness(t)
			snapshot, data := fixture()
			extra := map[string]any{}
			switch scenario {
			case "wrong_hash":
				snapshot.Media[0].SHA256 = strings.Repeat("a", 64)
			case "wrong_size":
				snapshot.Media[0].Size++
			case "wrong_mime":
				snapshot.Media[0].MIME = "image/svg+xml"
			case "wrong_dimensions":
				snapshot.Media[0].Width = 99
			case "unsafe_asset":
				snapshot.Media[0].AssetID = "../outside"
			case "external_preview":
				snapshot.Media[0].PreviewURL = "https://attacker.invalid/file"
			case "unknown_manifest":
				extra["openid"] = "fake"
			case "wrong_format":
				snapshot.Media[0].MIME = "image/jpeg"
			case "oversize_image":
				snapshot.Media[0].Size = imageLimit + 1
			case "oversize_video":
				snapshot.Media[0].Kind = "video"
				snapshot.Media[0].MIME = "video/mp4"
				snapshot.Media[0].Size = videoLimit + 1
			}
			snapshot.Fingerprint = workflow.HandoffSnapshotFingerprint(snapshot)
			response := multipartRequest(t, h, snapshot, data, extra)
			if response.Code != 400 {
				t.Fatalf("unsafe upload accepted: %d %s", response.Code, response.Body.String())
			}
			entries, _ := os.ReadDir(filepath.Join(h.data, "sessions"))
			if len(entries) != 0 {
				t.Fatal("failed upload left accessible files")
			}
		})
	}
	h := newHarness(t)
	created, _ := h.create(t)
	opened := h.open(t, created)
	path := h.server.mediaPath(created.ID, "asset-a")
	data, _ := os.ReadFile(path)
	data[len(data)-1] ^= 1
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	response := request(h.server.Handler(), "GET", opened.Envelope.Snapshot.Media[0].PreviewURL, "", "", nil)
	if response.Code != 410 || !strings.Contains(response.Body.String(), "integrity") {
		t.Fatal("modified copied bytes served")
	}
}

func TestCloudUploadRequiresExactlyDeclaredFiles(t *testing.T) {
	for _, scenario := range []string{"missing", "duplicate", "unexpected", "manifest_last"} {
		t.Run(scenario, func(t *testing.T) {
			h := newHarness(t)
			snapshot, data := fixture()
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			manifest := func() {
				part, _ := writer.CreateFormField("manifest")
				_ = json.NewEncoder(part).Encode(map[string]any{"snapshot": snapshot})
			}
			file := func(name string) {
				part, _ := writer.CreateFormFile(name, "file.png")
				_, _ = io.Copy(part, bytes.NewReader(data))
			}
			if scenario != "manifest_last" {
				manifest()
			}
			if scenario != "missing" {
				file("asset_asset-a")
			}
			if scenario == "duplicate" {
				file("asset_asset-a")
			}
			if scenario == "unexpected" {
				file("asset_unknown")
			}
			if scenario == "manifest_last" {
				manifest()
			}
			_ = writer.Close()
			response := request(h.server.Handler(), "POST", "/control/sessions", h.key, writer.FormDataContentType(), &body)
			if response.Code != 400 {
				t.Fatal("malformed multipart upload accepted")
			}
		})
	}
}

func TestCloudRangeMediaAndOpaqueMutationTokens(t *testing.T) {
	h := newHarness(t)
	created, data := h.create(t)
	opened := h.open(t, created)
	r := httptest.NewRequest("GET", opened.Envelope.Snapshot.Media[0].PreviewURL, nil)
	r.Header.Set("Range", "bytes=2-9")
	w := httptest.NewRecorder()
	h.server.Handler().ServeHTTP(w, r)
	if w.Code != 206 || !bytes.Equal(w.Body.Bytes(), data[2:10]) {
		t.Fatalf("range serving failed: %d", w.Code)
	}
	key := strings.Split(opened.Envelope.Snapshot.Media[0].PreviewURL, "?key=")[1]
	if response := request(h.server.Handler(), "POST", "/v1/development/claim", key, "application/json", strings.NewReader("{}")); response.Code != 401 {
		t.Fatal("read-only media capability mutated session")
	}
}

func TestCloudConfigAndBrowserIsolation(t *testing.T) {
	for _, origin := range []string{"http://public.example.com", "http://127.0.0.1:8083/path", "https://user:secret@example.com", "https://example.com?key=secret", "file:///tmp/cloud"} {
		if _, err := New(Config{DataDir: t.TempDir(), PublicURL: origin, ControlKey: strings.Repeat("a", 32)}); err == nil {
			t.Fatalf("unsafe origin accepted: %s", origin)
		}
	}
	h := newHarness(t)
	for _, path := range []string{"/receive?ticket=ignored", "/receiver.js", "/receiver.css"} {
		response := request(h.server.PublicHandler(), "GET", path, "", "", nil)
		if response.Code != 200 || strings.Contains(response.Body.String(), h.key) {
			t.Fatal("browser receiver missing or leaked control key")
		}
		if response.Header().Get("Referrer-Policy") != "no-referrer" || !strings.Contains(response.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
			t.Fatal("browser protection missing")
		}
	}
	if !strings.Contains(receiverJS, "textContent") || strings.Contains(receiverJS, "innerHTML") || strings.Contains(receiverJS, "xhs.login") {
		t.Fatal("receiver injects text or invokes XHS identity")
	}
}

func TestCloudEmptyChunkedActionBody(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		body   string
		status int
	}{
		{"empty", "", 200},
		{"empty_object", "{}", 200},
		{"forged_field", `{"openid":"forged"}`, 400},
		{"trailing_object", `{} {}`, 400},
		{"null", `null`, 400},
		{"oversized", strings.Repeat(" ", 1025), 400},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			h := newHarness(t)
			created, _ := h.create(t)
			opened := h.open(t, created)
			r := httptest.NewRequest("POST", "/v1/development/claim", strings.NewReader(scenario.body))
			r.ContentLength = -1
			r.TransferEncoding = []string{"chunked"}
			r.Header.Set("Authorization", "Bearer "+opened.ReceiverToken)
			w := httptest.NewRecorder()
			h.server.Handler().ServeHTTP(w, r)
			if w.Code != scenario.status {
				t.Fatalf("chunked %s: HTTP %d, want %d: %s", scenario.name, w.Code, scenario.status, w.Body.String())
			}
		})
	}
}
