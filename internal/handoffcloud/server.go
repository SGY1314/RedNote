// Package handoffcloud provides an isolated development handoff service. It has
// no platform account, publishing, collector or workbench database dependencies.
package handoffcloud

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"xhs-workbench/internal/domain"
)

var safeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type Config struct {
	DataDir    string
	PublicURL  string
	ControlKey string
	Now        func() time.Time
}

type Server struct {
	mu           sync.Mutex
	config       Config
	records      map[string]record
	mux          *http.ServeMux
	pending      int
	pendingBytes int64
}

type record struct {
	Session      domain.MiniappHandoffSession `json:"session"`
	TicketHash   string                       `json:"ticket_hash"`
	ReceiverHash string                       `json:"receiver_hash,omitempty"`
}

type CreateResponse struct {
	domain.MiniappHandoffSession
	Ticket     string `json:"ticket"`
	LaunchPath string `json:"launch_path"`
	BrowserURL string `json:"browser_url"`
}

type ReceiverResponse struct {
	Envelope      domain.MiniappHandoffSession `json:"envelope"`
	ReceiverToken string                       `json:"receiver_token,omitempty"`
}

type failure struct {
	code, message string
	status        int
}

func (e failure) Error() string { return e.message }

func fail(code, message string, status int) error { return failure{code, message, status} }

func New(config Config) (*Server, error) {
	base, err := url.Parse(config.PublicURL)
	if err != nil || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || (base.Path != "" && base.Path != "/") {
		return nil, errors.New("public URL must be an HTTP(S) origin")
	}
	if base.Scheme != "https" && (base.Scheme != "http" || !localHost(base.Hostname())) {
		return nil, errors.New("public HTTP is restricted to loopback or private development addresses; use HTTPS for public hosts")
	}
	if len(config.ControlKey) < 32 || strings.ContainsAny(config.ControlKey, "\r\n\t ") {
		return nil, errors.New("control key must contain at least 32 non-whitespace characters")
	}
	if config.DataDir == "" {
		return nil, errors.New("dedicated data directory is required")
	}
	config.DataDir, err = filepath.Abs(config.DataDir)
	if err != nil {
		return nil, err
	}
	config.PublicURL = strings.TrimRight(config.PublicURL, "/")
	if config.Now == nil {
		config.Now = time.Now
	}
	if err := os.MkdirAll(filepath.Join(config.DataDir, "sessions"), 0700); err != nil {
		return nil, err
	}
	s := &Server{config: config, records: map[string]record{}, mux: http.NewServeMux()}
	if err := s.load(); err != nil {
		return nil, err
	}
	s.routes()
	return s, nil
}

func localHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
		// No cookies or CORS: control endpoints are server-to-server, while the
		// browser receiver uses its own origin and explicit capability tokens.
		if origin := r.Header.Get("Origin"); origin != "" && origin != s.config.PublicURL {
			writeError(w, fail("origin_rejected", "Cross-origin requests are disabled", 403))
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}

// PublicHandler may be placed behind a development HTTPS proxy. It never serves
// desktop control operations, including when a valid control key is supplied.
func (s *Server) PublicHandler() http.Handler {
	internal := s.Handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/control") {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		internal.ServeHTTP(w, r)
	})
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /fixtures/publisher-check-v1.png", publisherFixture)
	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"mode": "development", "service": "handoff-cloud", "official_publishing": false})
	})
	s.mux.HandleFunc("POST /control/sessions", s.control(s.create))
	s.mux.HandleFunc("GET /control/sessions/{id}", s.control(s.readControl))
	s.mux.HandleFunc("POST /control/sessions/{id}/cancel", s.control(s.cancelControl))
	s.mux.HandleFunc("POST /v1/development/open", s.open)
	s.mux.HandleFunc("GET /v1/development/session", s.receiver(""))
	s.mux.HandleFunc("POST /v1/development/claim", s.receiver("claimed"))
	s.mux.HandleFunc("POST /v1/development/editor", s.receiver("editor_opened"))
	s.mux.HandleFunc("POST /v1/development/cancel", s.receiver("cancelled"))
	s.mux.HandleFunc("GET /v1/media/{session}/{asset}", s.media)
	s.mux.HandleFunc("GET /receive", s.receivePage)
	s.mux.HandleFunc("GET /receiver.js", static("text/javascript; charset=utf-8", receiverJS))
	s.mux.HandleFunc("GET /receiver.css", static("text/css; charset=utf-8", receiverCSS))
}

func (s *Server) control(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !equalSecret(bearer(r), s.config.ControlKey) {
			writeError(w, fail("unauthorized", "Control authentication required", 401))
			return
		}
		next(w, r)
	}
}

func bearer(r *http.Request) string {
	value := r.Header.Get("Authorization")
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(value, "Bearer ")
}

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func equalSecret(a, b string) bool {
	return a != "" && subtle.ConstantTimeCompare([]byte(digest(a)), []byte(digest(b))) == 1
}
func token() (string, error) {
	data := make([]byte, 24)
	_, err := rand.Read(data)
	return base64.RawURLEncoding.EncodeToString(data), err
}

func strictJSON(reader io.Reader, dst any, limit int64) error {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil || int64(len(data)) > limit {
		return fail("invalid_payload", "Payload exceeds the allowed size", 400)
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fail("invalid_payload", "Invalid JSON payload", 400)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return fail("invalid_payload", "Only one JSON value is allowed", 400)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	var problem failure
	if !errors.As(err, &problem) {
		problem = failure{"internal_error", "The development handoff service could not complete the request", 500}
	}
	writeJSON(w, problem.status, map[string]any{"error": map[string]string{"code": problem.code, "message": problem.message}})
}
