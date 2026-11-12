package handoffcloud

import (
	_ "embed"
	"io"
	"net/http"
)

//go:embed receiver.html
var receiverHTML string

//go:embed receiver.js
var receiverJS string

//go:embed receiver.css
var receiverCSS string

func static(contentType, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", contentType)
		_, _ = io.WriteString(w, body)
	}
}

func (s *Server) receivePage(w http.ResponseWriter, r *http.Request) {
	static("text/html; charset=utf-8", receiverHTML)(w, r)
}
