package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"rk/internal/metrics"
	"rk/internal/sessions"
	"rk/internal/tmux"
	"rk/internal/validate"
)

// SessionFetcher fetches enriched session data.
type SessionFetcher interface {
	FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error)
}

// TmuxOps defines tmux operations used by handlers.
type TmuxOps interface {
	CreateSession(name, cwd, server string) error
	KillSession(session, server string) error
	KillSessionCtx(ctx context.Context, server, session string) error
	RenameSession(session, name, server string) error
	CreateWindow(session, name, cwd, server string) error
	KillWindow(windowID, server string) error
	MoveWindow(windowID string, targetIndex int, server string) error
	MoveWindowToSession(windowID, dstSession, server string) error
	RenameWindow(windowID, name, server string) error
	SendKeys(windowID, keys, server string) error
	SelectWindow(windowID, server string) error
	SelectWindowInSession(session, windowID, server string) error
	ListWindows(ctx context.Context, session, server string) ([]tmux.WindowInfo, error)
	ResolveWindowSession(ctx context.Context, server, windowID string) (string, error)
	SplitWindow(windowID string, horizontal bool, cwd string, server string) (string, error)
	KillActivePane(windowID, server string) error
	SetSessionColor(session string, color int, server string) error
	UnsetSessionColor(session string, server string) error
	SetWindowColor(windowID string, color int, server string) error
	UnsetWindowColor(windowID, server string) error
	ListServers(ctx context.Context) ([]string, error)
	ListSessions(ctx context.Context, server string) ([]tmux.SessionInfo, error)
	KillServer(server string) error
	ListKeys(server string) ([]string, error)
	SetWindowOption(ctx context.Context, windowID, server, option, value string) error
	UnsetWindowOption(ctx context.Context, windowID, server, option string) error
	SetWindowOptions(ctx context.Context, windowID, server string, ops []tmux.WindowOptionOp) error
	CreateWindowWithOptions(session, name, cwd, server string, ops []tmux.WindowOptionOp) error
	GetSessionOrder(ctx context.Context, server string) ([]string, error)
	SetSessionOrder(ctx context.Context, server string, order []string) error
	ListBoards(ctx context.Context) ([]tmux.BoardSummary, error)
	GetBoard(ctx context.Context, name string) ([]tmux.BoardEntry, error)
	ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error)
	PinBoard(ctx context.Context, server, windowID, board string) error
	UnpinBoard(ctx context.Context, server, windowID, board string) error
	ReorderBoard(ctx context.Context, server, windowID, board, before, after string) (string, error)
}

// Server holds handler dependencies.
type Server struct {
	logger   *slog.Logger
	sessions SessionFetcher
	tmux     TmuxOps
	hostname string
	metrics  *metrics.Collector
	sseHub   *sseHub
	sseOnce  sync.Once
}

// initSSEHub lazily creates the SSE hub on first use.
func (s *Server) initSSEHub() {
	s.sseOnce.Do(func() {
		s.sseHub = newSSEHub(s.sessions, s.metrics)
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

// prodSessionFetcher wraps the sessions package for production use. The
// provider, when set (after the tmuxctl Supervisor is up — see
// SetActiveWindowProvider), supplies the Tier-1 event-tracked active window. A
// nil provider degrades FetchSessions to Tier-2-only (base-pointer) behavior.
type prodSessionFetcher struct {
	provider sessions.ActiveWindowProvider
}

func (p *prodSessionFetcher) FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error) {
	return sessions.FetchSessions(ctx, server, p.provider)
}

// prodTmuxOps wraps the tmux package for production use.
type prodTmuxOps struct{}

func (p *prodTmuxOps) CreateSession(name, cwd, server string) error {
	return tmux.CreateSession(name, cwd, server)
}
func (p *prodTmuxOps) KillSession(session, server string) error {
	return tmux.KillSession(session, server)
}
func (p *prodTmuxOps) KillSessionCtx(ctx context.Context, server, session string) error {
	return tmux.KillSessionCtx(ctx, server, session)
}
func (p *prodTmuxOps) RenameSession(session, name, server string) error {
	return tmux.RenameSession(session, name, server)
}
func (p *prodTmuxOps) CreateWindow(session, name, cwd, server string) error {
	return tmux.CreateWindow(session, name, cwd, server)
}
func (p *prodTmuxOps) KillWindow(windowID, server string) error {
	return tmux.KillWindow(windowID, server)
}
func (p *prodTmuxOps) MoveWindow(windowID string, targetIndex int, server string) error {
	return tmux.MoveWindow(windowID, targetIndex, server)
}
func (p *prodTmuxOps) MoveWindowToSession(windowID, dstSession, server string) error {
	return tmux.MoveWindowToSession(windowID, dstSession, server)
}
func (p *prodTmuxOps) RenameWindow(windowID, name, server string) error {
	return tmux.RenameWindow(windowID, name, server)
}
func (p *prodTmuxOps) SendKeys(windowID, keys, server string) error {
	return tmux.SendKeys(windowID, keys, server)
}
func (p *prodTmuxOps) SelectWindow(windowID, server string) error {
	return tmux.SelectWindow(windowID, server)
}
func (p *prodTmuxOps) SelectWindowInSession(session, windowID, server string) error {
	return tmux.SelectWindowInSession(session, windowID, server)
}
func (p *prodTmuxOps) ListWindows(ctx context.Context, session, server string) ([]tmux.WindowInfo, error) {
	return tmux.ListWindows(ctx, session, server)
}
func (p *prodTmuxOps) ResolveWindowSession(ctx context.Context, server, windowID string) (string, error) {
	return tmux.ResolveWindowSession(ctx, server, windowID)
}
func (p *prodTmuxOps) SplitWindow(windowID string, horizontal bool, cwd string, server string) (string, error) {
	return tmux.SplitWindow(windowID, horizontal, cwd, server)
}
func (p *prodTmuxOps) KillActivePane(windowID, server string) error {
	return tmux.KillActivePane(windowID, server)
}
func (p *prodTmuxOps) SetSessionColor(session string, color int, server string) error {
	return tmux.SetSessionColor(session, color, server)
}
func (p *prodTmuxOps) UnsetSessionColor(session string, server string) error {
	return tmux.UnsetSessionColor(session, server)
}
func (p *prodTmuxOps) SetWindowColor(windowID string, color int, server string) error {
	return tmux.SetWindowColor(windowID, color, server)
}
func (p *prodTmuxOps) UnsetWindowColor(windowID, server string) error {
	return tmux.UnsetWindowColor(windowID, server)
}
func (p *prodTmuxOps) ListServers(ctx context.Context) ([]string, error) {
	return tmux.ListServers(ctx)
}
func (p *prodTmuxOps) ListSessions(ctx context.Context, server string) ([]tmux.SessionInfo, error) {
	return tmux.ListSessions(ctx, server)
}
func (p *prodTmuxOps) KillServer(server string) error {
	return tmux.KillServer(server)
}
func (p *prodTmuxOps) ListKeys(server string) ([]string, error) {
	return tmux.ListKeys(server)
}
func (p *prodTmuxOps) SetWindowOption(ctx context.Context, windowID, server, option, value string) error {
	return tmux.SetWindowOption(ctx, windowID, server, option, value)
}
func (p *prodTmuxOps) UnsetWindowOption(ctx context.Context, windowID, server, option string) error {
	return tmux.UnsetWindowOption(ctx, windowID, server, option)
}
func (p *prodTmuxOps) SetWindowOptions(ctx context.Context, windowID, server string, ops []tmux.WindowOptionOp) error {
	return tmux.SetWindowOptions(ctx, windowID, server, ops)
}
func (p *prodTmuxOps) CreateWindowWithOptions(session, name, cwd, server string, ops []tmux.WindowOptionOp) error {
	return tmux.CreateWindowWithOptions(session, name, cwd, server, ops)
}
func (p *prodTmuxOps) GetSessionOrder(ctx context.Context, server string) ([]string, error) {
	return tmux.GetSessionOrder(ctx, server)
}
func (p *prodTmuxOps) SetSessionOrder(ctx context.Context, server string, order []string) error {
	return tmux.SetSessionOrder(ctx, server, order)
}
func (p *prodTmuxOps) ListBoards(ctx context.Context) ([]tmux.BoardSummary, error) {
	return tmux.ListBoards(ctx)
}
func (p *prodTmuxOps) GetBoard(ctx context.Context, name string) ([]tmux.BoardEntry, error) {
	return tmux.GetBoard(ctx, name)
}
func (p *prodTmuxOps) ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error) {
	return tmux.ListBoardEntries(ctx, server)
}
func (p *prodTmuxOps) PinBoard(ctx context.Context, server, windowID, board string) error {
	return tmux.Pin(ctx, server, windowID, board)
}
func (p *prodTmuxOps) UnpinBoard(ctx context.Context, server, windowID, board string) error {
	return tmux.Unpin(ctx, server, windowID, board)
}

// ReorderBoard locates the (server, windowID, board) entry, computes a new
// order key strictly between the supplied neighbours via fractional indexing,
// and writes it back. Returns the new key on success.
func (p *prodTmuxOps) ReorderBoard(ctx context.Context, server, windowID, board, before, after string) (string, error) {
	beforeKey, afterKey, err := lookupNeighbourKeys(ctx, p, server, board, before, after)
	if err != nil {
		return "", err
	}
	newKey, err := tmux.ComputeOrderKey(beforeKey, afterKey)
	if err != nil {
		return "", err
	}
	if err := tmux.Reorder(ctx, server, windowID, board, newKey); err != nil {
		return "", err
	}
	return newKey, nil
}

// lookupNeighbourKeys translates neighbour windowIDs into their order keys on
// the named board+server. Either neighbour may be empty (prepend/append).
// A non-empty neighbour ID that does not exist on the board returns an error.
func lookupNeighbourKeys(ctx context.Context, ops interface {
	ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error)
}, server, board, beforeID, afterID string) (string, string, error) {
	entries, err := ops.ListBoardEntries(ctx, server)
	if err != nil {
		return "", "", err
	}
	keys := map[string]string{}
	for _, e := range entries {
		if e.Board == board {
			keys[e.WindowID] = e.OrderKey
		}
	}
	beforeKey := ""
	afterKey := ""
	if beforeID != "" {
		k, ok := keys[beforeID]
		if !ok {
			return "", "", errNeighbourNotFound
		}
		beforeKey = k
	}
	if afterID != "" {
		k, ok := keys[afterID]
		if !ok {
			return "", "", errNeighbourNotFound
		}
		afterKey = k
	}
	return beforeKey, afterKey, nil
}

// errNeighbourNotFound is returned when reorder is called with a neighbour
// windowID that has no entry on the target board+server.
var errNeighbourNotFound = neighbourNotFoundError{}

type neighbourNotFoundError struct{}

func (neighbourNotFoundError) Error() string { return "neighbour window not found on board" }

// NewRouter creates the chi router with all middleware and routes.
// Uses production dependencies (live tmux, real session fetcher).
// The ctx controls the lifecycle of background goroutines (e.g., metrics collector).
func NewRouter(ctx context.Context, logger *slog.Logger) chi.Router {
	router, _ := NewRouterAndServer(ctx, logger)
	return router
}

// NewRouterAndServer is the variant of NewRouter that also returns the
// underlying *Server, so callers (`rk serve`) can wire in additional hooks
// such as the tmuxctl WindowChangeSubscriber once their Supervisor is up.
func NewRouterAndServer(ctx context.Context, logger *slog.Logger) (chi.Router, *Server) {
	hostname, _ := os.Hostname()

	mc := metrics.NewCollector(metricsPollInterval)
	mc.Start(ctx)

	s := &Server{
		logger:   logger,
		sessions: &prodSessionFetcher{},
		tmux:     &prodTmuxOps{},
		hostname: hostname,
		metrics:  mc,
	}
	return s.buildRouter(), s
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
	r.Get("/api/sessions/order", s.handleSessionOrderGet)
	r.Post("/api/sessions/order", s.handleSessionOrderPost)
	r.Get("/api/boards", s.handleBoardsList)
	r.Get("/api/boards/{name}", s.handleBoardGet)
	r.Post("/api/boards/{name}/pin", s.handleBoardPin)
	r.Post("/api/boards/{name}/unpin", s.handleBoardUnpin)
	r.Post("/api/boards/{name}/reorder", s.handleBoardReorder)
	r.Post("/api/sessions/{session}/color", s.handleSessionColor)
	r.Post("/api/sessions/{session}/kill", s.handleSessionKill)
	r.Post("/api/sessions/{session}/rename", s.handleSessionRename)
	r.Post("/api/sessions/{session}/windows", s.handleWindowCreate)
	r.Post("/api/windows/{windowId}/kill", s.handleWindowKill)
	r.Post("/api/windows/{windowId}/move", s.handleWindowMove)
	r.Post("/api/windows/{windowId}/move-to-session", s.handleWindowMoveToSession)
	r.Post("/api/windows/{windowId}/rename", s.handleWindowRename)
	r.Post("/api/windows/{windowId}/options", s.handleWindowOptions)
	r.Post("/api/windows/{windowId}/keys", s.handleWindowKeys)
	r.Post("/api/windows/{windowId}/select", s.handleWindowSelect)
	r.Post("/api/windows/{windowId}/split", s.handleWindowSplit)
	r.Post("/api/windows/{windowId}/close-pane", s.handleClosePaneKill)
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

	// Settings (global, not per-server)
	r.Get("/api/settings/theme", s.handleGetTheme)
	r.Post("/api/settings/theme", s.handleSetTheme)
	r.Get("/api/settings/server-color", s.handleGetServerColor)
	r.Post("/api/settings/server-color", s.handleSetServerColor)

	// Reverse proxy for iframe windows
	r.HandleFunc("/proxy/{port}/*", s.handleProxy)
	r.HandleFunc("/proxy/{port}", s.handleProxy)

	// WebSocket relay
	r.Get("/relay/{windowId}", s.handleRelay)

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
