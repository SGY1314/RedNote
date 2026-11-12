package handoffcloud

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"xhs-workbench/internal/domain"
)

func (s *Server) exposed(session domain.MiniappHandoffSession) domain.MiniappHandoffSession {
	media := append([]domain.MiniappHandoffMedia(nil), session.Snapshot.Media...)
	for i := range media {
		media[i].PreviewURL = s.config.PublicURL + "/v1/media/" + session.ID + "/" + media[i].AssetID + "?key=" + s.mediaKey(session, media[i].AssetID)
	}
	session.Snapshot.Media = media
	return session
}

func (s *Server) mediaKey(session domain.MiniappHandoffSession, asset string) string {
	hash := hmac.New(sha256.New, []byte(s.config.ControlKey))
	_, _ = io.WriteString(hash, "read-only-media\n"+session.ID+"\n"+asset+"\n"+session.ExpiresAt+"\n"+session.Snapshot.Fingerprint)
	return base64.RawURLEncoding.EncodeToString(hash.Sum(nil))
}

func (s *Server) readControl(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, err := s.currentLocked(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, s.exposed(rec.Session))
}

func emptyPayload(r *http.Request) error {
	if r.Body == nil {
		return nil
	}
	// Reverse proxies may forward a genuinely empty POST with unknown length
	// (chunked encoding). Inspect the bounded body rather than trusting its
	// framing metadata; nonempty requests must still be an empty JSON object.
	data, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(data) > 1024 {
		return fail("invalid_payload", "Payload exceeds the allowed size", 400)
	}
	if len(data) == 0 {
		return nil
	}
	value := strings.TrimSpace(string(data))
	if !strings.HasPrefix(value, "{") {
		return fail("invalid_payload", "Only an empty JSON object is allowed", 400)
	}
	var empty struct{}
	return strictJSON(strings.NewReader(value), &empty, 1024)
}

func (s *Server) cancelControl(w http.ResponseWriter, r *http.Request) {
	if err := emptyPayload(r); err != nil {
		writeError(w, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, err := s.currentLocked(r.PathValue("id"))
	if err == nil && rec.Session.State != "expired" {
		rec, err = s.transitionLocked(rec, "cancelled")
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, s.exposed(rec.Session))
}

func (s *Server) open(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Ticket string `json:"ticket"`
	}
	if err := strictJSON(r.Body, &request, 1024); err != nil {
		writeError(w, err)
		return
	}
	if !safeID.MatchString(request.Ticket) || len(request.Ticket) != 32 {
		writeError(w, fail("invalid", "Invalid development ticket", 400))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var found record
	for _, rec := range s.records {
		if hmac.Equal([]byte(digest(request.Ticket)), []byte(rec.TicketHash)) {
			found = rec
			break
		}
	}
	if found.Session.ID == "" {
		writeError(w, fail("invalid", "The development ticket is invalid or unavailable", 404))
		return
	}
	rec, err := s.currentLocked(found.Session.ID)
	if err == nil {
		err = active(rec.Session)
	}
	if err == nil && rec.ReceiverHash != "" {
		err = fail("invalid", "This ticket was already received; reopen it on the same receiver or create another on the desktop", 409)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	receiver, err := token()
	if err != nil {
		writeError(w, err)
		return
	}
	rec.ReceiverHash = digest(receiver)
	rec, err = s.transitionLocked(rec, "scanned")
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, ReceiverResponse{Envelope: s.exposed(rec.Session), ReceiverToken: receiver})
}

func (s *Server) receiver(event string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if event != "" {
			if err := emptyPayload(r); err != nil {
				writeError(w, err)
				return
			}
		}
		credential := bearer(r)
		if len(credential) != 32 {
			writeError(w, fail("unauthorized", "Receiver authentication required", 401))
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		id := ""
		for _, rec := range s.records {
			if rec.ReceiverHash != "" && hmac.Equal([]byte(rec.ReceiverHash), []byte(digest(credential))) {
				id = rec.Session.ID
				break
			}
		}
		if id == "" {
			writeError(w, fail("unauthorized", "The receiver token is invalid", 401))
			return
		}
		rec, err := s.currentLocked(id)
		if err == nil {
			err = active(rec.Session)
		}
		if err == nil && event != "" {
			rec, err = s.transitionLocked(rec, event)
		}
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, 200, ReceiverResponse{Envelope: s.exposed(rec.Session)})
	}
}

func (s *Server) media(w http.ResponseWriter, r *http.Request) {
	id, asset := r.PathValue("session"), r.PathValue("asset")
	if !safeID.MatchString(id) || !safeID.MatchString(asset) {
		writeError(w, fail("not_found", "Media not found", 404))
		return
	}
	s.mu.Lock()
	rec, err := s.currentLocked(id)
	if err == nil {
		err = active(rec.Session)
	}
	var media domain.MiniappHandoffMedia
	if err == nil && !equalSecret(r.URL.Query().Get("key"), s.mediaKey(rec.Session, asset)) {
		err = fail("unauthorized", "Media capability required", 401)
	}
	if err == nil {
		for _, item := range rec.Session.Snapshot.Media {
			if item.AssetID == asset {
				media = item
				break
			}
		}
		if media.AssetID == "" {
			err = fail("not_found", "Media not found", 404)
		}
	}
	s.mu.Unlock()
	if err != nil {
		writeError(w, err)
		return
	}
	path := s.mediaPath(id, asset)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != media.Size {
		writeError(w, fail("invalid", "The copied media is missing or changed", 410))
		return
	}
	file, err := os.Open(path)
	if err != nil {
		writeError(w, err)
		return
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil || !strings.EqualFold(base16(hash.Sum(nil)), media.SHA256) {
		writeError(w, fail("invalid", "The copied media failed its integrity check", 410))
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		writeError(w, err)
		return
	}
	// Re-check after the potentially large integrity read and before any bytes
	// are returned. The guarded reader also notices revocation during streaming.
	reader := &guardedMedia{file: file, server: s, sessionID: id}
	if err := reader.check(); err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", media.MIME)
	w.Header().Set("Content-Disposition", "inline")
	http.ServeContent(w, r, asset, time.Time{}, reader)
}

func base16(data []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(data)*2)
	for i, value := range data {
		out[2*i] = digits[value>>4]
		out[2*i+1] = digits[value&15]
	}
	return string(out)
}

type guardedMedia struct {
	file      *os.File
	server    *Server
	sessionID string
}

func (g *guardedMedia) check() error {
	g.server.mu.Lock()
	defer g.server.mu.Unlock()
	rec, err := g.server.currentLocked(g.sessionID)
	if err != nil {
		return err
	}
	return active(rec.Session)
}
func (g *guardedMedia) Read(data []byte) (int, error) {
	if err := g.check(); err != nil {
		return 0, err
	}
	return g.file.Read(data)
}
func (g *guardedMedia) Seek(offset int64, whence int) (int64, error) {
	return g.file.Seek(offset, whence)
}
