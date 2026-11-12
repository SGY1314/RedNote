package handoffcloud

import (
	"bytes"
	"image/png"
	"net/http/httptest"
	"testing"
)

func TestFixedPublisherFixtureIsPublicInlinePNG(t *testing.T) {
	service, err := New(Config{DataDir: t.TempDir(), PublicURL: "https://fixture.example.com", ControlKey: "publisher-check-test-control-key-only"})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	service.PublicHandler().ServeHTTP(response, httptest.NewRequest("GET", "/fixtures/publisher-check-v1.png", nil))
	if response.Code != 200 || response.Header().Get("Content-Type") != "image/png" || response.Header().Get("Content-Disposition") != "inline" {
		t.Fatal("fixed fixture does not meet the documented publisher media requirements")
	}
	image, err := png.DecodeConfig(bytes.NewReader(response.Body.Bytes()))
	if err != nil || image.Width != 640 || image.Height != 800 || !bytes.Equal(response.Body.Bytes(), publisherCheckPNG) {
		t.Fatal("fixture is not the known fixed synthetic image", err)
	}
	if response.Header().Get("Set-Cookie") != "" {
		t.Fatal("fixture requires an account")
	}
}
