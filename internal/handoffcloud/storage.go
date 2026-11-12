package handoffcloud

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"xhs-workbench/internal/domain"
	"xhs-workbench/internal/workflow"
)

func (s *Server) directory(id string) string { return filepath.Join(s.config.DataDir, "sessions", id) }
func (s *Server) mediaPath(id, asset string) string {
	return filepath.Join(s.directory(id), asset+".bin")
}

func (s *Server) load() error {
	entries, err := os.ReadDir(filepath.Join(s.config.DataDir, "sessions"))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !safeID.MatchString(entry.Name()) {
			continue
		}
		path := filepath.Join(s.directory(entry.Name()), "state.json")
		info, statErr := os.Lstat(path)
		if errors.Is(statErr, os.ErrNotExist) {
			s.removeIncomplete(entry.Name())
			continue
		} // Interrupted upload, never made visible.
		if statErr != nil || !info.Mode().IsRegular() || info.Size() > 256<<10 {
			return errors.New("invalid cloud session metadata")
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		var rec record
		err = strictJSON(file, &rec, 256<<10)
		_ = file.Close()
		if err != nil || rec.Session.ID != entry.Name() || !validHash(rec.TicketHash) || (rec.ReceiverHash != "" && !validHash(rec.ReceiverHash)) {
			return errors.New("invalid cloud session metadata")
		}
		for _, media := range rec.Session.Snapshot.Media {
			if !safeID.MatchString(media.AssetID) {
				return errors.New("unsafe cloud media identifier")
			}
		}
		if _, _, err := workflow.ExpireDevelopmentHandoff(rec.Session, s.config.Now()); err != nil {
			return errors.New("invalid persisted development session")
		}
		s.records[rec.Session.ID] = rec
		if len(s.records) > 512 {
			return errors.New("development session capacity exceeded")
		}
	}
	return s.PruneExpired()
}

func (s *Server) removeIncomplete(id string) {
	// Only this service's random directory names and known temporary file names
	// are eligible. Unknown data is left untouched; there is no recursive delete.
	if len(id) != 32 || !safeID.MatchString(id) {
		return
	}
	entries, err := os.ReadDir(s.directory(id))
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		known := strings.HasSuffix(name, ".bin") && safeID.MatchString(strings.TrimSuffix(name, ".bin"))
		known = known || strings.HasPrefix(name, ".state-")
		if entry.Type().IsRegular() && known {
			_ = os.Remove(filepath.Join(s.directory(id), name))
		}
	}
	_ = os.Remove(s.directory(id))
}

func validHash(value string) bool {
	data, err := hex.DecodeString(value)
	return err == nil && len(data) == 32
}

// saveLocked publishes metadata only after a complete, flushed atomic write.
// Caller owns s.mu; raw tickets and receiver tokens never enter this record.
func (s *Server) saveLocked(rec record) error {
	path := filepath.Join(s.directory(rec.Session.ID), "state.json")
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(s.directory(rec.Session.ID), ".state-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if err := file.Chmod(0600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		return err
	}
	s.records[rec.Session.ID] = rec
	return nil
}

func (s *Server) currentLocked(id string) (record, error) {
	rec, ok := s.records[id]
	if !safeID.MatchString(id) || !ok {
		return record{}, fail("not_found", "Development handoff not found", 404)
	}
	updated, changed, err := workflow.ExpireDevelopmentHandoff(rec.Session, s.config.Now())
	if err != nil {
		return record{}, err
	}
	if changed {
		rec.Session = updated
		if err := s.saveLocked(rec); err != nil {
			return record{}, err
		}
	}
	return rec, nil
}

func active(session domain.MiniappHandoffSession) error {
	if session.State == "expired" {
		return fail("expired", "The development handoff has expired; create another on the desktop", 410)
	}
	if session.State == "cancelled" {
		return fail("cancelled", "The development handoff has been revoked", 410)
	}
	return nil
}

func (s *Server) transitionLocked(rec record, state string) (record, error) {
	updated, err := workflow.TransitionDevelopmentHandoff(rec.Session, state, s.config.Now())
	if err != nil {
		return rec, fail("invalid_transition", err.Error(), 409)
	}
	rec.Session = updated
	if err := s.saveLocked(rec); err != nil {
		return rec, err
	}
	return rec, nil
}

// PruneExpired removes copied media after expiry/revocation. Metadata is retained
// for one day so the desktop can still explain a terminal session state.
func (s *Server) PruneExpired() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id := range s.records {
		rec, err := s.currentLocked(id)
		if err != nil {
			return err
		}
		if rec.Session.State != "expired" && rec.Session.State != "cancelled" {
			continue
		}
		for _, media := range rec.Session.Snapshot.Media {
			if err := os.Remove(s.mediaPath(id, media.AssetID)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		expires, _ := time.Parse(time.RFC3339Nano, rec.Session.ExpiresAt)
		if s.config.Now().Before(expires.Add(24 * time.Hour)) {
			continue
		}
		if err := os.Remove(filepath.Join(s.directory(id), "state.json")); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		// Remove only an empty, generated directory; never recursively erase paths.
		_ = os.Remove(s.directory(id))
		delete(s.records, id)
	}
	return nil
}
