package workflow

import (
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"xhs-workbench/internal/domain"
)

const MiniappHandoffTTL = 10 * time.Minute

var (
	ErrHandoffTransition = errors.New("开发预演步骤无效，请按扫码、领取、打开编辑器的顺序操作")
	ErrHandoffExpired    = errors.New("交接会话已过期，请重新创建")
	ErrHandoffClosed     = errors.New("交接会话已撤销，不能继续预演")
	ErrHandoffSnapshot   = errors.New("交接快照校验失败，请重新创建")
)

func HandoffSnapshotFingerprint(snapshot domain.MiniappHandoffSnapshot) string {
	snapshot.Fingerprint = ""
	// A preview location may change when exporting to a different development
	// surface; only content identity belongs in the immutable fingerprint.
	media := make([]domain.MiniappHandoffMedia, len(snapshot.Media))
	copy(media, snapshot.Media)
	for i := range media {
		media[i].PreviewURL = ""
	}
	snapshot.Media = media
	return DigestValue(snapshot)
}

func ValidateHandoffSnapshot(snapshot domain.MiniappHandoffSnapshot) error {
	if snapshot.PublicationID == "" || snapshot.VersionID == "" || strings.TrimSpace(snapshot.Title) == "" || utf8.RuneCountInString(snapshot.Title) > 20 || utf8.RuneCountInString(snapshot.Body) > 1000 || len(snapshot.Media) == 0 || len(snapshot.Media) > 18 {
		return ErrHandoffSnapshot
	}
	// These are the shared development-fixture limits, not a claim about the
	// official publishing component's current platform quotas.
	if len(snapshot.Topics) > 20 {
		return ErrHandoffSnapshot
	}
	for _, topic := range snapshot.Topics {
		if strings.TrimSpace(topic) == "" || utf8.RuneCountInString(topic) > 100 || strings.ContainsAny(topic, ",\r\n") {
			return ErrHandoffSnapshot
		}
	}
	seen, videos := map[string]bool{}, 0
	for _, media := range snapshot.Media {
		digest, digestErr := hex.DecodeString(media.SHA256)
		if media.AssetID == "" || seen[media.AssetID] || digestErr != nil || len(digest) != 32 || media.Size <= 0 || media.Width < 0 || media.Height < 0 || media.Duration < 0 || math.IsNaN(media.Duration) || math.IsInf(media.Duration, 0) || !strings.HasPrefix(media.MIME, media.Kind+"/") || !strings.HasPrefix(media.PreviewURL, "/api/v1/assets/") {
			return ErrHandoffSnapshot
		}
		if media.Kind == "video" {
			videos++
		} else if media.Kind != "image" {
			return ErrHandoffSnapshot
		}
		seen[media.AssetID] = true
	}
	if videos > 0 && (videos != 1 || len(snapshot.Media) != 1) {
		return errors.New("开发交接支持 1–18 张图片或单个视频，请勿混合媒体")
	}
	if snapshot.Fingerprint == "" || snapshot.Fingerprint != HandoffSnapshotFingerprint(snapshot) {
		return ErrHandoffSnapshot
	}
	return nil
}

func NewDevelopmentHandoff(id string, snapshot domain.MiniappHandoffSnapshot, at time.Time) (domain.MiniappHandoffSession, error) {
	if id == "" {
		return domain.MiniappHandoffSession{}, ErrHandoffSnapshot
	}
	if err := ValidateHandoffSnapshot(snapshot); err != nil {
		return domain.MiniappHandoffSession{}, err
	}
	stamp := at.UTC().Format(time.RFC3339Nano)
	return domain.MiniappHandoffSession{
		SchemaVersion: 1, Mode: "development", ID: id, PublicationID: snapshot.PublicationID,
		State: "created", CreatedAt: stamp, UpdatedAt: stamp,
		ExpiresAt: at.Add(MiniappHandoffTTL).UTC().Format(time.RFC3339Nano),
		Snapshot:  snapshot, Events: []domain.MiniappHandoffEvent{{State: "created", At: stamp}},
	}, nil
}

func ExpireDevelopmentHandoff(session domain.MiniappHandoffSession, at time.Time) (domain.MiniappHandoffSession, bool, error) {
	if session.ID == "" || session.SchemaVersion != 1 || session.Mode != "development" || session.PublicationID != session.Snapshot.PublicationID || !validHandoffEventHistory(session) {
		return session, false, ErrHandoffSnapshot
	}
	if err := ValidateHandoffSnapshot(session.Snapshot); err != nil {
		return session, false, err
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil {
		return session, false, ErrHandoffSnapshot
	}
	if session.State != "cancelled" && session.State != "expired" && !at.Before(expires) {
		return appendHandoffEvent(session, "expired", at), true, nil
	}
	return session, false, nil
}

func validHandoffEventHistory(session domain.MiniappHandoffSession) bool {
	if len(session.Events) < 1 || len(session.Events) > 5 || session.Events[0].State != "created" || session.Events[0].At != session.CreatedAt || session.Events[len(session.Events)-1].State != session.State || session.Events[len(session.Events)-1].At != session.UpdatedAt {
		return false
	}
	previous := "created"
	for _, event := range session.Events[1:] {
		if previous == "cancelled" || previous == "expired" {
			return false
		}
		if event.State != "cancelled" && event.State != "expired" {
			allowed := map[string]string{"created": "scanned", "scanned": "claimed", "claimed": "editor_opened"}
			if allowed[previous] != event.State {
				return false
			}
		}
		if _, err := time.Parse(time.RFC3339Nano, event.At); err != nil {
			return false
		}
		previous = event.State
	}
	return previous == session.State
}

// TransitionDevelopmentHandoff returns a new value and never modifies the
// caller's event slice. Repeated completed steps are idempotent; skips fail.
func TransitionDevelopmentHandoff(session domain.MiniappHandoffSession, event string, at time.Time) (domain.MiniappHandoffSession, error) {
	current, _, err := ExpireDevelopmentHandoff(session, at)
	if err != nil {
		return session, err
	}
	if current.State == "expired" {
		return current, ErrHandoffExpired
	}
	if event == "cancelled" {
		if current.State == "cancelled" {
			return current, nil
		}
		return appendHandoffEvent(current, event, at), nil
	}
	if current.State == "cancelled" {
		return current, ErrHandoffClosed
	}
	ranks := map[string]int{"created": 0, "scanned": 1, "claimed": 2, "editor_opened": 3}
	next, supported := ranks[event]
	previous, valid := ranks[current.State]
	if !supported || !valid || next == 0 || next > previous+1 {
		return current, ErrHandoffTransition
	}
	if next <= previous {
		return current, nil
	}
	return appendHandoffEvent(current, event, at), nil
}

func appendHandoffEvent(session domain.MiniappHandoffSession, state string, at time.Time) domain.MiniappHandoffSession {
	session.State = state
	session.UpdatedAt = at.UTC().Format(time.RFC3339Nano)
	events := make([]domain.MiniappHandoffEvent, len(session.Events), len(session.Events)+1)
	copy(events, session.Events)
	session.Events = append(events, domain.MiniappHandoffEvent{State: state, At: session.UpdatedAt})
	return session
}
