package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestControlKeyGeneratedOnceAndNeverOverwritten(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "control.key")
	key, err := readOrCreateKey(path)
	if err != nil || len(key) != 43 {
		t.Fatal("random control key was not created")
	}
	again, err := readOrCreateKey(path)
	if err != nil || key != again {
		t.Fatal("existing control key was replaced")
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("a", 5000)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readOrCreateKey(path); err == nil {
		t.Fatal("oversized key file accepted")
	}
}

func TestListenersStayOnLoopback(t *testing.T) {
	for _, address := range []string{"127.0.0.1:8083", "localhost:8084", "[::1]:8084"} {
		if !loopbackAddress(address) {
			t.Fatal("loopback listener rejected")
		}
	}
	for _, address := range []string{":8084", "0.0.0.0:8084", "192.168.1.2:8084", "example.com:8084"} {
		if loopbackAddress(address) {
			t.Fatal("non-loopback listener accepted")
		}
	}
}
