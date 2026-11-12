// Workbench fork: ownership and optional metric regression tests.
package main

import (
	"github.com/xpzouying/xiaohongshu-mcp/xiaohongshu"
	"testing"
)

func TestWorkbenchOwnCard(t *testing.T) {
	f := xiaohongshu.Feed{ID: "0123456789abcdef01234567", ModelType: "note", NoteCard: xiaohongshu.NoteCard{User: xiaohongshu.User{UserID: "owner"}, InteractInfo: xiaohongshu.InteractInfo{LikedCount: "0"}}}
	n, ok := ownCard(f, "owner")
	if !ok || n.Metrics.Likes != "0" || n.Metrics.Comments != "" {
		t.Fatal("zero and unknown conflated")
	}
	if _, ok = ownCard(f, "other"); ok {
		t.Fatal("foreign note accepted")
	}
	f.ID = "../escape"
	if _, ok = ownCard(f, "owner"); ok {
		t.Fatal("invalid ID accepted")
	}
}
