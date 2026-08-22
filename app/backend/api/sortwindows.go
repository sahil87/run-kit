package api

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"rk/internal/tmux"
	"rk/internal/validate"
)

// statusRank maps a window's enriched rollup signals to its attention-first
// sort rank (0 = most attention-demanding) for the sort-windows verb's
// by=status key. It linearizes the status pyramid's tier precedence into a
// total order: the pyramid's decision table (docs/specs/status-pyramid.md §
// Decision Table) defines which signal owns the sidebar DOT; this table defines
// tab ORDER from the same signals. A window's rank is the minimum (most
// attention-demanding) rank among its matched predicates — the switch's
// first-match order IS that minimum. No match ⇒ rank 4 (plain).
func statusRank(w tmux.WindowInfo) int {
	switch {
	// 0 — attention: agent waiting, PR action-needed, fab review-failed.
	case w.AgentState == tmux.AgentStateWaiting,
		w.PrState == "open" && (w.PrChecks == "fail" || w.PrReview == "changes_requested"),
		w.FabDisplayState == "failed":
		return 0
	// 1 — active work: agent active, fab in-flight, PR checks running.
	case w.AgentState == tmux.AgentStateActive,
		w.FabChange != "" && (w.FabDisplayState == "active" || w.FabDisplayState == "ready" || w.FabDisplayState == "pending"),
		w.PrState == "open" && w.PrChecks == "pending":
		return 1
	// 2 — settled: PR merged, fab done, healthy open PR (its fail/pending/
	// changes_requested shapes already matched ranks 0–1).
	case w.PrState == "merged",
		w.FabChange != "" && w.FabDisplayState == "done",
		w.PrState == "open":
		return 2
	// 3 — idle agent.
	case w.AgentState == tmux.AgentStateIdle:
		return 3
	// 4 — plain tmux window (a fab-skipped window with no other signal falls
	// through to here, per the pyramid ladder).
	default:
		return 4
	}
}

// windowIDNum extracts the numeric part of a "@N" tmux window ID. tmux assigns
// window IDs monotonically at creation and exposes no window-creation
// timestamp, so the numeric ID IS the creation order (numeric, not
// lexicographic: @9 sorts before @10). An unparseable ID sinks to the end.
func windowIDNum(id string) int {
	n, err := strconv.Atoi(strings.TrimPrefix(id, "@"))
	if err != nil {
		return math.MaxInt
	}
	return n
}

// sortWindowsTarget computes the deterministic target order for a session's
// windows without mutating the input. The sort is STABLE: equal keys preserve
// current relative order, so re-running the verb on an already-sorted session
// reproduces the current order (and planSortMoves then yields an empty batch).
func sortWindowsTarget(windows []tmux.WindowInfo, by string) []tmux.WindowInfo {
	target := make([]tmux.WindowInfo, len(windows))
	copy(target, windows)
	switch by {
	case "created":
		sort.SliceStable(target, func(i, j int) bool {
			return windowIDNum(target[i].WindowID) < windowIDNum(target[j].WindowID)
		})
	case "status":
		sort.SliceStable(target, func(i, j int) bool {
			return statusRank(target[i]) < statusRank(target[j])
		})
	}
	return target
}

// sortMove is one planned MoveWindow call: move windowID to before dstIndex.
type sortMove struct {
	windowID string
	dstIndex int
}

// planSortMoves computes the MoveWindow batch that reorders windows into
// target order. It walks target positions over the session's sorted current
// index VALUES — tmux window indexes need not be 0-based or contiguous, but
// the set of values is invariant under swap-window — simulating each
// insert-before move so later destinations account for earlier ones. A window
// already in its target slot emits no move, so an already-sorted session
// yields an empty batch (no tmux mutation).
func planSortMoves(windows []tmux.WindowInfo, target []tmux.WindowInfo) []sortMove {
	slots := make([]int, len(windows))
	working := make([]string, len(windows))
	for i, w := range windows {
		slots[i] = w.Index
		working[i] = w.WindowID
	}
	sort.Ints(slots)

	var moves []sortMove
	for i := range target {
		// Positions before i are already in target order, so target[i] sits at
		// some position j >= i in the working order.
		j := i
		for k := i; k < len(working); k++ {
			if working[k] == target[i].WindowID {
				j = k
				break
			}
		}
		if j == i {
			continue
		}
		moves = append(moves, sortMove{windowID: target[i].WindowID, dstIndex: slots[i]})
		// Simulate the insert-before move: elements i..j-1 shift one right.
		copy(working[i+1:j+1], working[i:j])
		working[i] = target[i].WindowID
	}
	return moves
}

// handleSessionSortWindows reorders a session's windows by a deterministic
// key. POST /api/sessions/{session}/sort-windows ← {"by":"status"|"created"} →
// 200 {"order": ["@N", ...], "moved": <count>}. All validation (session name,
// JSON body, the by-allowlist) completes before ANY tmux call; an unknown
// session is a 404.
func (s *Server) handleSessionSortWindows(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	var body struct {
		By string `json:"by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.By != "status" && body.By != "created" {
		writeError(w, http.StatusBadRequest, "by must be one of: status, created")
		return
	}

	server := serverFromRequest(r)
	result, err := s.sessions.FetchSessions(r.Context(), server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	found := false
	var windows []tmux.WindowInfo
	for _, ps := range result {
		if ps.Name == session {
			windows = ps.Windows
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "Session not found")
		return
	}

	target := sortWindowsTarget(windows, body.By)
	moves := planSortMoves(windows, target)
	for _, m := range moves {
		if err := s.tmux.MoveWindow(m.windowID, m.dstIndex, server); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	if len(moves) > 0 {
		// Wake the SSE hub so the reorder repaints immediately rather than on
		// the next derive tick. initSSEHub is idempotent.
		s.initSSEHub()
		s.sseHub.wake(server)
	}

	order := make([]string, len(target))
	for i, win := range target {
		order[i] = win.WindowID
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"order": order, "moved": len(moves)})
}
