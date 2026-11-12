package handoffcloud

import (
	"crypto/sha256"
	"encoding/hex"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/workflow"
)

const imageLimit = 20 << 20
const videoLimit = 1 << 30

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	if err := s.PruneExpired(); err != nil {
		writeError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, videoLimit+(512<<10))
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, fail("invalid", "A multipart manifest and media files are required", 400))
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "manifest" || part.FileName() != "" {
		writeError(w, fail("invalid", "The first part must be the JSON manifest", 400))
		return
	}
	var manifest struct {
		Snapshot  domain.MiniappHandoffSnapshot `json:"snapshot"`
		ExpiresAt string                        `json:"expires_at,omitempty"`
	}
	err = strictJSON(part, &manifest, 256<<10)
	_ = part.Close()
	if err != nil {
		writeError(w, err)
		return
	}
	if err := validateUpload(manifest.Snapshot); err != nil {
		writeError(w, err)
		return
	}
	if err := s.reserveUpload(manifest.Snapshot); err != nil {
		writeError(w, err)
		return
	}
	defer s.releaseUpload(manifest.Snapshot)
	deadline := s.config.Now().Add(workflow.MiniappHandoffTTL)
	if manifest.ExpiresAt != "" {
		requested, err := time.Parse(time.RFC3339Nano, manifest.ExpiresAt)
		if err != nil || !requested.After(s.config.Now()) {
			writeError(w, fail("expired", "The source handoff has expired", 410))
			return
		}
		if requested.Before(deadline) {
			deadline = requested
		}
	}
	id, err := token()
	if err != nil {
		writeError(w, err)
		return
	}
	if err := os.Mkdir(s.directory(id), 0700); err != nil {
		writeError(w, err)
		return
	}
	committed := false
	defer func() {
		if !committed {
			s.removeUpload(id, manifest.Snapshot.Media)
		}
	}()
	remaining := map[string]domain.MiniappHandoffMedia{}
	for _, media := range manifest.Snapshot.Media {
		remaining["asset_"+media.AssetID] = media
	}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(w, fail("invalid", "Incomplete media upload", 400))
			return
		}
		media, ok := remaining[part.FormName()]
		if !ok {
			_ = part.Close()
			writeError(w, fail("invalid", "Unexpected or duplicate media field", 400))
			return
		}
		if err := copyMedia(part, s.mediaPath(id, media.AssetID), media); err != nil {
			_ = part.Close()
			writeError(w, err)
			return
		}
		delete(remaining, part.FormName())
		_ = part.Close()
	}
	if len(remaining) != 0 {
		writeError(w, fail("invalid", "Some media files are missing", 400))
		return
	}
	session, err := workflow.NewDevelopmentHandoff(id, manifest.Snapshot, s.config.Now())
	if err != nil {
		writeError(w, fail("invalid", err.Error(), 400))
		return
	}
	if !deadline.After(s.config.Now()) {
		writeError(w, fail("expired", "The source handoff expired during upload", 410))
		return
	}
	session.ExpiresAt = deadline.UTC().Format(time.RFC3339Nano)
	ticket, err := token()
	if err != nil {
		writeError(w, err)
		return
	}
	s.mu.Lock()
	err = s.saveLocked(record{Session: session, TicketHash: digest(ticket)})
	s.mu.Unlock()
	if err != nil {
		writeError(w, err)
		return
	}
	committed = true
	writeJSON(w, 201, CreateResponse{MiniappHandoffSession: s.exposed(session), Ticket: ticket,
		LaunchPath: "pages/publish/index?scene=" + ticket, BrowserURL: s.config.PublicURL + "/receive?ticket=" + ticket})
}

func validateUpload(snapshot domain.MiniappHandoffSnapshot) error {
	if err := workflow.ValidateHandoffSnapshot(snapshot); err != nil {
		return fail("invalid", err.Error(), 400)
	}
	for _, media := range snapshot.Media {
		if !safeID.MatchString(media.AssetID) {
			return fail("invalid", "Unsafe media identifier", 400)
		}
		if media.Kind == "image" && ((media.MIME != "image/png" && media.MIME != "image/jpeg") || media.Size > imageLimit) {
			return fail("invalid", "Images must be PNG/JPEG and at most 20 MiB", 400)
		}
		if media.Kind == "video" && (media.MIME != "video/mp4" || media.Size > videoLimit) {
			return fail("invalid", "A video must be MP4 and at most 1 GiB", 400)
		}
	}
	return nil
}

func copyMedia(part *multipart.Part, path string, media domain.MiniappHandoffMedia) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(part, media.Size+1))
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil || written != media.Size || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), media.SHA256) {
		return fail("invalid", "Media size or SHA-256 does not match the frozen manifest", 400)
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	return verifyMediaFormat(path, media)
}

func verifyMediaFormat(path string, media domain.MiniappHandoffMedia) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if media.Kind == "image" {
		config, format, err := image.DecodeConfig(file)
		mime := "image/" + format
		if format == "jpeg" {
			mime = "image/jpeg"
		}
		if err != nil || mime != media.MIME || config.Width <= 0 || config.Height <= 0 || (media.Width > 0 && config.Width != media.Width) || (media.Height > 0 && config.Height != media.Height) {
			return fail("invalid", "The image content does not match its MIME or dimensions", 400)
		}
		return nil
	}
	prefix := make([]byte, 12)
	if _, err := io.ReadFull(file, prefix); err != nil || string(prefix[4:8]) != "ftyp" {
		return fail("invalid", "The uploaded video is not an MP4 container", 400)
	}
	return nil
}

func (s *Server) removeUpload(id string, media []domain.MiniappHandoffMedia) {
	for _, item := range media {
		_ = os.Remove(s.mediaPath(id, item.AssetID))
	}
	_ = os.Remove(filepath.Join(s.directory(id), "state.json"))
	_ = os.Remove(s.directory(id))
}

func snapshotBytes(snapshot domain.MiniappHandoffSnapshot) int64 {
	var total int64
	for _, media := range snapshot.Media {
		total += media.Size
	}
	return total
}

// The local simulator has a small hard disk budget, including concurrent
// uploads. It is intentionally not an unbounded general-purpose object store.
func (s *Server) reserveUpload(snapshot domain.MiniappHandoffSnapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending >= 2 || len(s.records)+s.pending >= 512 {
		return fail("capacity", "The development service is busy or full; try again later", 503)
	}
	total := s.pendingBytes + snapshotBytes(snapshot)
	for _, rec := range s.records {
		if rec.Session.State != "expired" && rec.Session.State != "cancelled" {
			total += snapshotBytes(rec.Session.Snapshot)
		}
	}
	if total > 4*int64(videoLimit) {
		return fail("capacity", "The development service has reached its 4 GiB copied-media limit", 503)
	}
	s.pending++
	s.pendingBytes += snapshotBytes(snapshot)
	return nil
}

func (s *Server) releaseUpload(snapshot domain.MiniappHandoffSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending--
	s.pendingBytes -= snapshotBytes(snapshot)
}
