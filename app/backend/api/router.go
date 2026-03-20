package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"run-kit/internal/sessions"
	"run-kit/internal/tmux"
)

// SessionFetcher fetches enriched session data.
type SessionFetcher interface {
	FetchSessions() ([]sessions.ProjectSession, error)
}

// TmuxOps defines tmux operations used by handlers.
type TmuxOps interface {
	CreateSession(name, cwd string) error
	KillSession(session string) error
	RenameSession(session, name string) error
	CreateWindow(session, name, cwd string) error
	KillWindow(session string, index int) error
	RenameWindow(session string, index int, name string) error
	SendKeys(session string, window int, keys string) error
	SelectWindow(session string, index int) error
	ListWindows(session string, server string) ([]tmux.WindowInfo, error)
	SplitWindow(session string, window int) (string, error)
	KillPane(paneID string) error
}

// Server holds handler dependencies.
type Server struct {
	logger   *slog.Logger
	sessions SessionFetcher
	tmux     TmuxOps
	sseHub   *sseHub
	sseOnce  sync.Once
}

// initSSEHub lazily creates the SSE hub on first use.
func (s *Server) initSSEHub() {
	s.sseOnce.Do(func() {
		s.sseHub = newSSEHub(s.sessions)
	})
}

// prodSessionFetcher wraps the sessions package for production use.
type prodSessionFetcher struct{}

func (p *prodSessionFetcher) FetchSessions() ([]sessions.ProjectSession, error) {
	return sessions.FetchSessions()
}

// prodTmuxOps wraps the tmux package for production use.
type prodTmuxOps struct{}

func (p *prodTmuxOps) CreateSession(name, cwd string) error {
	return tmux.CreateSession(name, cwd)
}
func (p *prodTmuxOps) KillSession(session string) error {
	return tmux.KillSession(session)
}
func (p *prodTmuxOps) RenameSession(session, name string) error {
	return tmux.RenameSession(session, name)
}
func (p *prodTmuxOps) CreateWindow(session, name, cwd string) error {
	return tmux.CreateWindow(session, name, cwd)
}
func (p *prodTmuxOps) KillWindow(session string, index int) error {
	return tmux.KillWindow(session, index)
}
func (p *prodTmuxOps) RenameWindow(session string, index int, name string) error {
	return tmux.RenameWindow(session, index, name)
}
func (p *prodTmuxOps) SendKeys(session string, window int, keys string) error {
	return tmux.SendKeys(session, window, keys)
}
func (p *prodTmuxOps) SelectWindow(session string, index int) error {
	return tmux.SelectWindow(session, index)
}
func (p *prodTmuxOps) ListWindows(session string, server string) ([]tmux.WindowInfo, error) {
	return tmux.ListWindows(session, server)
}
func (p *prodTmuxOps) SplitWindow(session string, window int) (string, error) {
	return tmux.SplitWindow(session, window)
}
func (p *prodTmuxOps) KillPane(paneID string) error {
	return tmux.KillPane(paneID)
}

// NewRouter creates the chi router with all middleware and routes.
// Uses production dependencies (live tmux, real session fetcher).
func NewRouter(logger *slog.Logger) chi.Router {
	s := &Server{
		logger:   logger,
		sessions: &prodSessionFetcher{},
		tmux:     &prodTmuxOps{},
	}
	return s.buildRouter()
}

// NewTestRouter creates a chi router with injectable dependencies for testing.
func NewTestRouter(logger *slog.Logger, sf SessionFetcher, ops TmuxOps) chi.Router {
	s := &Server{
		logger:   logger,
		sessions: sf,
		tmux:     ops,
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
