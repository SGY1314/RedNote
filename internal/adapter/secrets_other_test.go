//go:build !windows

package adapter

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	key := []byte("0123456789abcdef0123456789abcdef")
	if e := os.WriteFile(path, key, 0600); e != nil {
		t.Fatal(e)
	}
	t.Setenv("WORKBENCH_KEY_FILE", path)
	a, e := Seal("secret-value")
	if e != nil {
		t.Fatal(e)
	}
	b, e := Seal("secret-value")
	if e != nil || a == b || strings.Contains(a, "secret-value") {
		t.Fatal("non-random encryption")
	}
	plain, e := Unseal(a)
	if e != nil || plain != "secret-value" {
		t.Fatal("round trip", e)
	}
	if _, e = Unseal(a[:len(a)-4] + "AAAA"); e == nil {
		t.Fatal("tampering accepted")
	}
	os.WriteFile(path, []byte("abcdef0123456789abcdef0123456789"), 0600)
	if _, e = Unseal(a); e == nil {
		t.Fatal("wrong key accepted")
	}
	os.Chmod(path, 0644)
	if _, e = Seal("value"); e == nil {
		t.Fatal("public master key accepted")
	}
	if _, e = Unseal("dpapi:old"); e == nil {
		t.Fatal("Windows session accepted")
	}
	os.Remove(path)
	if _, e = Seal("value"); e == nil {
		t.Fatal("missing key silently regenerated")
	}
}
