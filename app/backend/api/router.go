package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"run-kit/internal/sessions"
	"run-kit/internal/tmux"
	"run-kit/internal/validate"
)

// SessionFetcher fetches enriched session data.
type SessionFetcher interface {
	FetchSessions(server string) ([]sessions.ProjectSession, error)
}

// TmuxOps defines tmux operations used by handlers.
type TmuxOps interface {
	CreateSession(name, cwd, server string) error
	KillSession(session, server string) error
	RenameSession(session, name, server string) error
	CreateWindow(session, name, cwd, server string) error
	KillWindow(session string, index int, server string) error
	RenameWindow(session string, index int, name, server string) error
	SendKeys(session string, window int, keys, server string) error
	SelectWindow(session string, index int, server string) error
	ListWindows(session, server string) ([]tmux.WindowInfo, error)
	SplitWindow(session string, window int, server string) (string, error)
	KillPane(paneID, server string) error
	ListServers() ([]string, error)
	KillServer(server string) error
	ListKeys(server string) ([]string, error)
}

// Server holds handler dependencies.
type Server struct {
	logger   *slog.Logger
	sessions SessionFetcher
	tmux     TmuxOps
	hostname string
	sseHub   *sseHub
	sseOnce  sync.Once
}

// initSSEHub lazily creates the SSE hub on first use.
func (s *Server) initSSEHub() {
	s.sseOnce.Do(func() {
		s.sseHub = newSSEHub(s.sessions)
	})
}

// serverFromRequest extracts and validates the server query parameter from the
// request, defaulting to "default" if absent or invalid.
func serverFromRequest(r *http.Request) string {
	s := r.URL.Query().Get("server")
	if s == "" {
		return "default"
	}
	if validate.ValidateServerName(s) != "" {
		return "default"
	}
	return s
}

// prodSessionFetcher wraps the sessions package for production use.
type prodSessionFetcher struct{}

func (p *prodSessionFetcher) FetchSessions(server string) ([]sessions.ProjectSession, error) {
	return sessions.FetchSessions(server)
}

// prodTmuxOps wraps the tmux package for production use.
type prodTmuxOps struct{}

func (p *prodTmuxOps) CreateSession(name, cwd, server string) error {
	return tmux.CreateSession(name, cwd, server)
}
func (p *prodTmuxOps) KillSession(session, server string) error {
	return tmux.KillSession(session, server)
}
func (p *prodTmuxOps) RenameSession(session, name, server string) error {
	return tmux.RenameSession(session, name, server)
}
func (p *prodTmuxOps) CreateWindow(session, name, cwd, server string) error {
	return tmux.CreateWindow(session, name, cwd, server)
}
func (p *prodTmuxOps) KillWindow(session string, index int, server string) error {
	return tmux.KillWindow(session, index, server)
}
func (p *prodTmuxOps) RenameWindow(session string, index int, name, server string) error {
	return tmux.RenameWindow(session, index, name, server)
}
func (p *prodTmuxOps) SendKeys(session string, window int, keys, server string) error {
	return tmux.SendKeys(session, window, keys, server)
}
func (p *prodTmuxOps) SelectWindow(session string, index int, server string) error {
	return tmux.SelectWindow(session, index, server)
}
func (p *prodTmuxOps) ListWindows(session, server string) ([]tmux.WindowInfo, error) {
	return tmux.ListWindows(session, server)
}
func (p *prodTmuxOps) SplitWindow(session string, window int, server string) (string, error) {
	return tmux.SplitWindow(session, window, server)
}
func (p *prodTmuxOps) KillPane(paneID, server string) error {
	return tmux.KillPane(paneID, server)
}
func (p *prodTmuxOps) ListServers() ([]string, error) {
	return tmux.ListServers()
}
func (p *prodTmuxOps) KillServer(server string) error {
	return tmux.KillServer(server)
}
func (p *prodTmuxOps) ListKeys(server string) ([]string, error) {
	return tmux.ListKeys(server)
}

// NewRouter creates the chi router with all middleware and routes.
// Uses production dependencies (live tmux, real session fetcher).
func NewRouter(logger *slog.Logger) chi.Router {
	hostname, _ := os.Hostname()
	s := &Server{
		logger:   logger,
		sessions: &prodSessionFetcher{},
		tmux:     &prodTmuxOps{},
		hostname: hostname,
	}
	return s.buildRouter()
}

// NewTestRouter creates a chi router with injectable dependencies for testing.
func NewTestRouter(logger *slog.Logger, sf SessionFetcher, ops TmuxOps, hostname string) chi.Router {
	s := &Server{
		logger:   logger,
		sessions: sf,
		tmux:     ops,
		hostname: hostname,
	}
	return s.buildRouter()
}

func (s *Server) buildRouter() chi.Router {
	r := chi.NewRouter()

	// Middleware stack
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// API routes
	r.Get("/api/health", s.handleHealth)
	r.Get("/api/sessions", s.handleSessionsList)
	r.Post("/api/sessions", s.handleSessionCreate)
	r.Post("/api/sessions/{session}/kill", s.handleSessionKill)
	r.Post("/api/sessions/{session}/rename", s.handleSessionRename)
	r.Post("/api/sessions/{session}/windows", s.handleWindowCreate)
	r.Post("/api/sessions/{session}/windows/{index}/kill", s.handleWindowKill)
	r.Post("/api/sessions/{session}/windows/{index}/rename", s.handleWindowRename)
	r.Post("/api/sessions/{session}/windows/{index}/keys", s.handleWindowKeys)
	r.Post("/api/sessions/{session}/windows/{index}/select", s.handleWindowSelect)
	r.Get("/api/directories", s.handleDirectories)
	r.Post("/api/sessions/{session}/upload", s.handleUpload)
	r.Get("/api/sessions/stream", s.handleSSE)
	r.Post("/api/tmux/reload-config", s.handleTmuxReloadConfig)
	r.Post("/api/tmux/init-conf", s.handleTmuxInitConf)

	// Server management routes
	r.Get("/api/servers", s.handleServersList)
	r.Post("/api/servers", s.handleServerCreate)
	r.Post("/api/servers/kill", s.handleServerKill)

	// Keybindings
	r.Get("/api/keybindings", s.handleKeybindings)

	// WebSocket relay
	r.Get("/relay/{session}/{window}", s.handleRelay)

	// SPA static serving — catch-all, must be last
	s.mountSPA(r)

	return r
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
