package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"rk/internal/metrics"
	"rk/internal/ports"
	"rk/internal/prstatus"
	"rk/internal/riff"
	"rk/internal/sessions"
	"rk/internal/tmux"
	"rk/internal/updatecheck"
	"rk/internal/validate"
)

const (
	// statusRefreshMinInterval is the server-side minimum interval between forced
	// refreshes started by POST /api/status/refresh. This handler is the single
	// frequency-control choke point, so ANY trigger (button-mashing, multiple
	// tabs, future auto-triggers) is safe to over-fire: a call arriving within
	// this window returns 202 without starting a refresh. Mash-safe and well
	// under both poller tick cadences (viewer 90s, branch 30s).
	statusRefreshMinInterval = 10 * time.Second
	// statusRefreshTimeout bounds the detached refresh goroutine's own context.
	// The viewer collector's gh call is 10s-bounded internally; the branch pass
	// is one gh-per-registered-pair, so 60s bounds the whole pass without
	// truncating it. NOT r.Context() (which dies when the handler returns).
	statusRefreshTimeout = 60 * time.Second
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
	HasSession(ctx context.Context, server, session string) bool
	SplitWindow(windowID string, horizontal bool, cwd string, server string) (string, error)
	KillActivePane(windowID, server string) error
	SetSessionColor(session string, colorValue string, server string) error
	UnsetSessionColor(session string, server string) error
	SetWindowColor(windowID string, colorValue string, server string) error
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
	GetServerRank(ctx context.Context, server string) (*int, error)
	SetServerRank(ctx context.Context, server string, rank int) error
	ListBoards(ctx context.Context) ([]tmux.BoardSummary, error)
	GetBoard(ctx context.Context, name string) ([]tmux.BoardEntry, error)
	ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error)
	PinBoard(ctx context.Context, server, windowID, board string) error
	UnpinBoard(ctx context.Context, server, windowID, board string) error
	ReorderBoard(ctx context.Context, server, windowID, board, before, after string) (string, error)
	// Chat-send injection primitives (260714-jdyg-chat-send). Pane-targeted, in
	// contrast to the window-targeted SendKeys used by POST /keys. CapturePane is
	// surfaced here for the echo probe. Each takes the caller's context so the
	// handler threads ONE shared deadline across the whole set → paste → probe →
	// Enter sequence (kept well under the 5s route-blocking budget) rather than
	// granting each subprocess an independent 10s timeout.
	SetChatSendBuffer(ctx context.Context, text, server string) error
	PasteChatSendBuffer(ctx context.Context, paneID, server string) error
	SendEnterToPane(ctx context.Context, paneID, server string) error
	CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error)
}

// RiffEngine is the web-facing seam onto the extracted spawn engine
// (internal/riff). It is a DEDICATED dependency — deliberately NOT folded into
// TmuxOps — so the shared mockTmuxOps (used by every handler test) is untouched
// and the riff handler gets its own focused mock. Mirrors the metrics/services/
// prStatus collector injection pattern.
type RiffEngine interface {
	Spawn(ctx context.Context, opts riff.Options) (riff.Result, error)
}

// prodRiffEngine wraps the internal/riff package for production use.
type prodRiffEngine struct{}

func (prodRiffEngine) Spawn(ctx context.Context, opts riff.Options) (riff.Result, error) {
	return riff.Spawn(ctx, opts)
}

// Server holds handler dependencies.
type Server struct {
	logger        *slog.Logger
	sessions      SessionFetcher
	tmux          TmuxOps
	riff          RiffEngine
	hostname      string
	metrics       *metrics.Collector
	services      *ports.Collector
	prStatus      *prstatus.Collector
	updateChecker *updatecheck.Checker
	sseHub        *sseHub
	sseOnce       sync.Once
	// version is the running daemon version (ldflags-injected main.version),
	// seeded once at startup via SetVersion. Read by handleRestart's dev guard
	// (a "dev" build must not bounce the real daemon out from under `just dev`'s
	// air process). In-memory only (Constitution II) — same lifetime as the
	// SSE version slot.
	version string

	// Manual status-refresh (POST /api/status/refresh) — the single frequency
	// choke point for forced refreshes of BOTH PR pollers.
	//
	// refreshCollectorFn / refreshBranchFn are the two on-demand kicks. Function
	// fields (mirroring the collector-injection house pattern) so handler tests
	// can assert both fire without spawning gh. Defaulted in NewRouterAndServer;
	// nil is a no-op (either kick may be absent on a partially-wired server).
	refreshCollectorFn func(context.Context)
	refreshBranchFn    func(context.Context)
	// refreshStatusMu guards the coalesce/throttle state below.
	refreshStatusMu sync.Mutex
	// refreshStatusInFlight is true while a detached refresh goroutine runs — a
	// concurrent POST coalesces onto it (no second refresh).
	refreshStatusInFlight bool
	// refreshStatusLast is the start time of the most recent forced refresh, used
	// for the min-interval throttle.
	refreshStatusLast time.Time
	// nowFn is a clock seam (defaults to time.Now) so throttle behavior is
	// deterministically testable without real sleeps.
	nowFn func() time.Time
}

// now returns the server clock, defaulting to time.Now when unseeded (the test
// router leaves nowFn nil).
func (s *Server) now() time.Time {
	if s.nowFn != nil {
		return s.nowFn()
	}
	return time.Now()
}

// initSSEHub lazily creates the SSE hub on first use.
func (s *Server) initSSEHub() {
	s.sseOnce.Do(func() {
		// A nil *prstatus.Collector must be passed as a nil interface so the
		// hub's nil check (no PR fields attached) works — wrap only when set.
		var pc PRStatusSnapshotter
		if s.prStatus != nil {
			pc = s.prStatus
		}
		s.sseHub = newSSEHub(s.sessions, s.metrics, s.services, pc)
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
func (p *prodTmuxOps) HasSession(ctx context.Context, server, session string) bool {
	return tmux.HasSession(ctx, server, session)
}
func (p *prodTmuxOps) SplitWindow(windowID string, horizontal bool, cwd string, server string) (string, error) {
	return tmux.SplitWindow(windowID, horizontal, cwd, server)
}
func (p *prodTmuxOps) KillActivePane(windowID, server string) error {
	return tmux.KillActivePane(windowID, server)
}
func (p *prodTmuxOps) SetSessionColor(session string, colorValue string, server string) error {
	return tmux.SetSessionColor(session, colorValue, server)
}
func (p *prodTmuxOps) UnsetSessionColor(session string, server string) error {
	return tmux.UnsetSessionColor(session, server)
}
func (p *prodTmuxOps) SetWindowColor(windowID string, colorValue string, server string) error {
	return tmux.SetWindowColor(windowID, colorValue, server)
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
func (p *prodTmuxOps) GetServerRank(ctx context.Context, server string) (*int, error) {
	return tmux.GetServerRank(ctx, server)
}
func (p *prodTmuxOps) SetServerRank(ctx context.Context, server string, rank int) error {
	return tmux.SetServerRank(ctx, server, rank)
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
func (p *prodTmuxOps) SetChatSendBuffer(ctx context.Context, text, server string) error {
	return tmux.SetChatSendBufferCtx(ctx, text, server)
}
func (p *prodTmuxOps) PasteChatSendBuffer(ctx context.Context, paneID, server string) error {
	return tmux.PasteChatSendBufferCtx(ctx, paneID, server)
}
func (p *prodTmuxOps) SendEnterToPane(ctx context.Context, paneID, server string) error {
	return tmux.SendEnterToPaneCtx(ctx, paneID, server)
}
func (p *prodTmuxOps) CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error) {
	return tmux.CapturePaneCtx(ctx, paneID, lines, server)
}

// ReorderBoard locates the (server, windowID, board) entry, computes a new
// order key strictly between the supplied neighbours via fractional indexing,
// and writes it back. Returns the new key on success.
func (p *prodTmuxOps) ReorderBoard(ctx context.Context, server, windowID, board, before, after string) (string, error) {
	beforeKey, afterKey, err := lookupNeighbourKeys(ctx, p, board, before, after)
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
// the named board, resolving them against the board's entries aggregated across
// ALL reachable servers — mirroring handleGetBoard's cross-server aggregation
// (a board spans servers, so a neighbour pinned from a different server than the
// moved pane is a legitimate on-board neighbour). Either neighbour may be empty
// (prepend/append). A non-empty neighbour ID absent from the board on EVERY
// server returns errNeighbourNotFound.
func lookupNeighbourKeys(ctx context.Context, ops interface {
	ListServers(ctx context.Context) ([]string, error)
	ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error)
}, board, beforeID, afterID string) (string, string, error) {
	servers, err := ops.ListServers(ctx)
	if err != nil {
		return "", "", err
	}
	if len(servers) == 0 {
		servers = []string{"default"}
	}
	// Aggregate the board's (windowID → orderKey) map across every server. A
	// windowID is unique per tmux server but a board spans servers, so the
	// neighbour may live on a different server than the moved pane. Collisions
	// across servers are not a concern here: neighbours are addressed by the
	// same windowIDs the client read from GET /api/boards/{name} (itself a
	// cross-server aggregation), so a last-writer-wins map matches that source.
	keys := map[string]string{}
	for _, srv := range servers {
		entries, lerr := ops.ListBoardEntries(ctx, srv)
		if lerr != nil {
			// Skip an unreachable server rather than failing the whole lookup —
			// matches GetBoard/ListBoards, which log-and-continue per server.
			// Without the log, an unreachable server that happens to hold the
			// neighbour silently degrades to a 400; the warning leaves a trace.
			slog.Warn("board: ListBoardEntries failed", "server", srv, "err", lerr)
			continue
		}
		for _, e := range entries {
			if e.Board == board {
				keys[e.WindowID] = e.OrderKey
			}
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

	svc := ports.NewCollector(servicesPollInterval)
	svc.Start(ctx)

	pc := prstatus.NewCollector(prStatusPollInterval)
	pc.Start(ctx)

	// Branch→PR refresher (260705-dmex): resolves observed (repo, branch) pairs
	// to their open PR on a background tick so the SSE hot path (which only
	// registers pairs + joins the snapshot) never spawns gh. Started next to the
	// viewer-wide collector; both exit on ctx cancellation.
	prstatus.DefaultBranchRefresher.Start(ctx)

	s := &Server{
		logger:   logger,
		sessions: &prodSessionFetcher{},
		tmux:     &prodTmuxOps{},
		riff:     prodRiffEngine{},
		hostname: hostname,
		metrics:  mc,
		services: svc,
		prStatus: pc,
	}
	// Wire the two on-demand PR-refresh kicks for POST /api/status/refresh. The
	// collector kick nil-guards its own pointer (a partially-wired server may
	// have none); the branch kick targets the process-wide default refresher
	// Start()ed above.
	s.refreshCollectorFn = func(ctx context.Context) {
		if s.prStatus != nil {
			s.prStatus.RefreshNow(ctx)
		}
	}
	s.refreshBranchFn = prstatus.DefaultBranchRefresher.RefreshNow
	return s.buildRouter(), s
}

// NewTestRouter creates a chi router with injectable dependencies for testing.
// The riff engine is left nil (the riff handler tests inject one directly via
// NewTestRouterWithRiff); riff-unrelated tests never reach it.
func NewTestRouter(logger *slog.Logger, sf SessionFetcher, ops TmuxOps, hostname string) chi.Router {
	s := &Server{
		logger:   logger,
		sessions: sf,
		tmux:     ops,
		hostname: hostname,
	}
	return s.buildRouter()
}

// NewTestRouterWithRiff is NewTestRouter plus an injected RiffEngine, used by the
// riff handler tests to supply a mock engine without touching the shared
// TmuxOps/mockTmuxOps surface.
func NewTestRouterWithRiff(logger *slog.Logger, sf SessionFetcher, ops TmuxOps, engine RiffEngine, hostname string) chi.Router {
	s := &Server{
		logger:   logger,
		sessions: sf,
		tmux:     ops,
		riff:     engine,
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
	r.Post("/api/boards/order", s.handleBoardOrderPost)
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
	r.Get("/api/windows/{windowId}/chat", s.handleChatBackfill)
	r.Post("/api/windows/{windowId}/chat/send", s.handleChatSend)
	r.Get("/api/directories", s.handleDirectories)
	r.Post("/api/sessions/{session}/upload", s.handleUpload)
	r.Post("/api/preview-scope", s.handlePreviewScope)
	r.Post("/api/tmux/reload-config", s.handleTmuxReloadConfig)
	r.Post("/api/tmux/init-conf", s.handleTmuxInitConf)
	r.Post("/api/status/refresh", s.handleStatusRefresh)
	r.Post("/api/update", s.handleUpdate)
	r.Post("/api/updates/check", s.handleUpdatesCheck)
	r.Post("/api/restart", s.handleRestart)

	// Riff — web-UI agent spawn (POST) + preset list (GET). See api/riff.go.
	r.Post("/api/riff", s.handleRiffSpawn)
	r.Get("/api/riff/presets", s.handleRiffPresets)

	// Server management routes
	r.Get("/api/servers", s.handleServersList)
	r.Post("/api/servers", s.handleServerCreate)
	r.Post("/api/servers/order", s.handleServerOrderPost)
	r.Post("/api/servers/kill", s.handleServerKill)

	// Keybindings
	r.Get("/api/keybindings", s.handleKeybindings)

	// Settings (global, not per-server)
	r.Get("/api/settings/theme", s.handleGetTheme)
	r.Post("/api/settings/theme", s.handleSetTheme)
	r.Get("/api/settings/server-color", s.handleGetServerColor)
	r.Post("/api/settings/server-color", s.handleSetServerColor)

	// Web Push: VAPID key (read), subscribe + notify (mutations, POST per §IX)
	r.Get("/api/push/vapid-public-key", s.handlePushVAPIDPublicKey)
	r.Post("/api/push/subscribe", s.handlePushSubscribe)
	r.Post("/api/notify", s.handleNotify)

	// Reverse proxy for iframe windows
	r.HandleFunc("/proxy/{port}/*", s.handleProxy)
	r.HandleFunc("/proxy/{port}", s.handleProxy)

	// State socket — muxed session-state + host-metrics stream (replaces the
	// retired GET /api/sessions/stream SSE edge; see api/state_ws.go).
	r.Get("/ws/state", s.handleStateWS)

	// Terminals socket — muxed terminal I/O: ONE WebSocket per tab carrying all
	// pane relay streams (replaces the retired per-pane GET /relay/{windowId} +
	// handleRelay; see api/terminals_ws.go).
	r.Get("/ws/terminals", s.handleTerminalsWS)

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
