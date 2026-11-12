package app

import (
	"strings"
	"testing"
)

func TestStorageFailureIsNotReportedAsMissingRecord(t *testing.T) {
	a := testApp(t)
	if err := a.Store.DB.Close(); err != nil {
		t.Fatal(err)
	}
	body := request(t, a, "GET", "/rewrites/missing", nil, 500)
	if !strings.Contains(string(body), "读取记录失败") || strings.Contains(string(body), "记录不存在") {
		t.Fatalf("storage error was misclassified: %s", body)
	}
}
