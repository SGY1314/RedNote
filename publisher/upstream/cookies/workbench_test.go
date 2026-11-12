// Workbench fork: modified for local QR publishing (publisher/README.md).
package cookies

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkbenchDPAPISession(t *testing.T) {
	p := filepath.Join(t.TempDir(), "session.dpapi")
	c := NewLoadCookie(p)
	data := []byte(`[{"name":"session","value":"private-test-token"}]`)
	if err := c.SaveCookies(data); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(p)
	if bytes.Contains(raw, []byte("private-test-token")) {
		t.Fatal("session stored in plaintext")
	}
	got, err := c.LoadCookies()
	var compact bytes.Buffer
	if err != nil || json.Compact(&compact, got) != nil || !bytes.Equal(compact.Bytes(), data) {
		t.Fatal("session roundtrip failed", err)
	}
	if err := c.DeleteCookies(); err != nil {
		t.Fatal(err)
	}
}
