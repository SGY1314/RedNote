package handoffcloud

import (
	_ "embed"
	"net/http"
	"strconv"
)

// This public synthetic PNG is deliberately independent of all drafts,
// receiver credentials and accounts. It exists only for the fixed-image
// post-note-button capability check.
//
//go:embed publisher-check-v1.png
var publisherCheckPNG []byte

func publisherFixture(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Content-Length", strconv.Itoa(len(publisherCheckPNG)))
	w.Write(publisherCheckPNG)
}
