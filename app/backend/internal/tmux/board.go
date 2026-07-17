package tmux

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
)

// Board membership is derived entirely from single-window pin-sessions
// (`_rk-pin-*`) and their session-scoped user options — there is no `@rk_board`
// server-option encoding (Constitution II: state derived from tmux). A board is
// the set of pin-sessions sharing a `@rk_board` value.
//
//   - @rk_board       — which board this pinned window belongs to
//   - @rk_home        — the home session to restore the window to on unpin
//   - @rk_board_order — fractional order key within the board (ComputeOrderKey)
const (
	BoardOption      = "@rk_board"
	HomeOption       = "@rk_home"
	BoardOrderOption = "@rk_board_order"
)

// BoardEntry represents a single (server, windowID) pin to a named board,
// derived from a `_rk-pin-*` session's vars.
type BoardEntry struct {
	Server   string `json:"server"`
	WindowID string `json:"windowId"`
	Board    string `json:"board"`
	OrderKey string `json:"orderKey"`
}

// BoardSummary is a per-board pin count returned by ListBoards.
type BoardSummary struct {
	Name     string `json:"name"`
	PinCount int    `json:"pinCount"`
}

var (
	boardNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
	windowIDPattern  = regexp.MustCompile(`^@\d+$`)
	orderKeyPattern  = regexp.MustCompile(`^[a-z]{1,16}$`)
)

// ValidBoardName reports whether name is a syntactically valid board name.
// Pattern: alphanumeric + hyphen + underscore, length 1-32.
func ValidBoardName(name string) bool {
	return boardNamePattern.MatchString(name)
}

// ValidWindowID reports whether id matches tmux's `#{window_id}` form (`@<digits>`).
func ValidWindowID(id string) bool {
	return windowIDPattern.MatchString(id)
}

// ValidOrderKey reports whether key is a valid lexicographic order key
// (1-16 lowercase ASCII letters).
func ValidOrderKey(key string) bool {
	return orderKeyPattern.MatchString(key)
}

// isAbsentOption returns true when err is one of the operational tmux states
// that map to "no entries" rather than a real error: option unset, no server
// running, or socket not connectable.
func isAbsentOption(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "invalid option") ||
		strings.Contains(msg, "unknown option") ||
		strings.Contains(msg, "no server running") ||
		strings.Contains(msg, "failed to connect")
}

// showSessionOption reads a single session-scoped user option from a session,
// returning "" (no error) when the option is unset or the server is
// unreachable. Other failures propagate.
func showSessionOption(ctx context.Context, server, session, option string) (string, error) {
	out, err := tmuxExecRawServer(ctx, server, "show-options", "-v", "-t", ExactSessionTarget(session), option)
	if err != nil {
		if isAbsentOption(err) {
			return "", nil
		}
		return "", fmt.Errorf("read %s on %s/%s: %w", option, server, session, err)
	}
	return strings.TrimSpace(out), nil
}

// setSessionOption sets a session-scoped user option on a session.
func setSessionOption(ctx context.Context, server, session, option, value string) error {
	_, err := tmuxExecRawServer(ctx, server, "set-option", "-t", ExactSessionTarget(session), option, value)
	return err
}

// pinEntry derives the BoardEntry for a single pin-session by reading its
// session vars. Returns (entry, true, nil) when the session carries a valid
// @rk_board value; (zero, false, nil) when it is not a board pin (no/invalid
// @rk_board) — a defensive skip rather than an error.
func pinEntry(ctx context.Context, server, pinSession string) (BoardEntry, bool, error) {
	windowID, ok := WindowIDFromPinSession(pinSession)
	if !ok {
		return BoardEntry{}, false, nil
	}
	board, err := showSessionOption(ctx, server, pinSession, BoardOption)
	if err != nil {
		return BoardEntry{}, false, err
	}
	if !ValidBoardName(board) {
		// Not a board pin (or malformed) — skip without error.
		return BoardEntry{}, false, nil
	}
	orderKey, err := showSessionOption(ctx, server, pinSession, BoardOrderOption)
	if err != nil {
		return BoardEntry{}, false, err
	}
	if !ValidOrderKey(orderKey) {
		orderKey = initialAppendKey
	}
	return BoardEntry{
		Server:   server,
		WindowID: windowID,
		Board:    board,
		OrderKey: orderKey,
	}, true, nil
}

// ListBoardEntries returns the pinned-window entries on the named server,
// derived from its `_rk-pin-*` sessions. Returns ([]BoardEntry{}, nil) when no
// pin-sessions exist or the server is not reachable — normal operational states.
func ListBoardEntries(ctx context.Context, server string) ([]BoardEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	pins, err := ListPinSessionNames(ctx, server)
	if err != nil {
		if isAbsentOption(err) {
			return []BoardEntry{}, nil
		}
		return nil, fmt.Errorf("list pin sessions on %s: %w", server, err)
	}
	out := make([]BoardEntry, 0, len(pins))
	for _, pin := range pins {
		entry, ok, derr := pinEntry(ctx, server, pin)
		if derr != nil {
			slog.Warn("board: pin-session var read failed", "server", server, "pin", pin, "err", derr)
			continue
		}
		if !ok {
			continue
		}
		out = append(out, entry)
	}
	return out, nil
}

// ListBoards returns the alphabetical per-board pin-count summary across all
// reachable servers, derived from pin-sessions. A board exists only while at
// least one pin-session carries its name (no empty boards, no registry).
func ListBoards(ctx context.Context) ([]BoardSummary, error) {
	servers, err := ListServers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list servers: %w", err)
	}
	if len(servers) == 0 {
		servers = []string{"default"}
	}
	counts := make(map[string]int)
	for _, s := range servers {
		entries, lerr := ListBoardEntries(ctx, s)
		if lerr != nil {
			slog.Warn("board: ListBoardEntries failed", "server", s, "err", lerr)
			continue
		}
		for _, e := range entries {
			counts[e.Board]++
		}
	}
	out := make([]BoardSummary, 0, len(counts))
	for name, count := range counts {
		out = append(out, BoardSummary{Name: name, PinCount: count})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// GetBoard returns entries for a single board across all reachable servers,
// sorted by order key. Membership is derived live from pin-sessions, so there
// is no stale entry to clean up — a killed pinned window's session simply
// disappears from the listing.
func GetBoard(ctx context.Context, name string) ([]BoardEntry, error) {
	if !ValidBoardName(name) {
		return nil, fmt.Errorf("invalid board name")
	}
	servers, err := ListServers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list servers: %w", err)
	}
	if len(servers) == 0 {
		servers = []string{"default"}
	}
	out := make([]BoardEntry, 0)
	for _, s := range servers {
		entries, lerr := ListBoardEntries(ctx, s)
		if lerr != nil {
			slog.Warn("board: ListBoardEntries failed", "server", s, "err", lerr)
			continue
		}
		for _, e := range entries {
			if e.Board == name {
				out = append(out, e)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].OrderKey < out[j].OrderKey })
	return out, nil
}

// initialAppendKey is the first order key assigned when a board has no
// entries. Using a midpoint letter leaves headroom for both prepend and
// append operations, which is important since the alphabet has no
// representation strictly less than "a".
const initialAppendKey = "m"

// nextAppendKey returns an order key strictly greater than the largest existing
// key among the supplied board entries (lexicographic). Empty → initialAppendKey.
func nextAppendKey(entries []BoardEntry) string {
	maxKey := ""
	for _, e := range entries {
		if e.OrderKey > maxKey {
			maxKey = e.OrderKey
		}
	}
	if maxKey == "" {
		return initialAppendKey
	}
	next, err := ComputeOrderKey(maxKey, "")
	if err != nil {
		return maxKey + "a"
	}
	return next
}

// Pin MOVES the window identified by windowID into its own single-window
// pin-session `_rk-pin-<id>` and records its board membership. The window leaves
// its home session (intended — this is what removes window sharing and lets a
// board pane attach directly to the pin-session).
//
// Idempotent: if `_rk-pin-<id>` already exists, Pin is a no-op (no re-move, no
// order-key churn).
//
// Security (Constitution §I): windowID and board are validated before any
// subprocess; every tmux call is ctx+timeout-scoped via the package exec
// helpers with explicit argument slices (no shell strings).
func Pin(ctx context.Context, server, windowID, board string) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	if !ValidWindowID(windowID) {
		return fmt.Errorf("invalid window id")
	}
	if !ValidBoardName(board) {
		return fmt.Errorf("invalid board name")
	}
	pinSession, ok := PinSessionName(windowID)
	if !ok {
		return fmt.Errorf("invalid window id")
	}

	// Idempotency: the pin-session already exists → the window is already pinned.
	// Re-pin makes the requested board win and repairs the order key if it went
	// missing, so the pin is always board-derivable and sortable. We do NOT try to
	// repair @rk_home here: once a window lives in its pin-session, its "current
	// session" IS the pin-session, so there is no source to re-derive the original
	// home from. @rk_home durability is instead guaranteed at creation by the
	// stamp-before-move ordering below (it is written while the pin-session is
	// still empty, so the window never enters a pin-session lacking @rk_home).
	// A window has exactly one pin-session, so this is the sole authoritative
	// place its membership lives.
	if _, err := tmuxExecRawServer(ctx, server, "has-session", "-t", ExactSessionTarget(pinSession)); err == nil {
		// @rk_board: always set to the requested board (different-board re-pin must
		// not silently keep the old board; same-board is a harmless idempotent set).
		if err := setSessionOption(ctx, server, pinSession, BoardOption, board); err != nil {
			return fmt.Errorf("re-stamp %s on existing pin %q: %w", BoardOption, pinSession, err)
		}
		// @rk_board_order: repair only if missing/invalid so GetBoard can sort it.
		curOrder, oerr := showSessionOption(ctx, server, pinSession, BoardOrderOption)
		if oerr != nil {
			return fmt.Errorf("read %s on existing pin %q: %w", BoardOrderOption, pinSession, oerr)
		}
		if !ValidOrderKey(curOrder) {
			if err := setSessionOption(ctx, server, pinSession, BoardOrderOption, initialAppendKey); err != nil {
				return fmt.Errorf("repair %s on existing pin %q: %w", BoardOrderOption, pinSession, err)
			}
		}
		return nil
	}

	// Resolve the home session to remember for unpin. The window must currently
	// live in a home session (not already a pin-session).
	home, err := ResolveWindowSession(ctx, server, windowID)
	if err != nil {
		return fmt.Errorf("resolve home session: %w", err)
	}

	// Compute the append key restricted to this board BEFORE the move (the
	// window still counts under its old session, but board membership is read
	// from existing pin-sessions, which excludes this window).
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		return err
	}
	boardEntries := make([]BoardEntry, 0)
	for _, e := range entries {
		if e.Board == board {
			boardEntries = append(boardEntries, e)
		}
	}
	orderKey := nextAppendKey(boardEntries)

	// Create the pin-session (starts with one placeholder window) and capture the
	// placeholder window's ID so we can kill it after the move, leaving the moved
	// window as the session's sole window. Capturing the placeholder ID (rather
	// than assuming index 0) is robust to base-index config and to the moved
	// window's landing index.
	if _, err := tmuxExecServer(ctx, server, "new-session", "-d", "-s", pinSession); err != nil {
		return fmt.Errorf("create pin session: %w", err)
	}
	placeholderLines, err := tmuxExecServer(ctx, server, "list-windows", "-t", ExactSessionTarget(pinSession), "-F", "#{window_id}")
	if err != nil || len(placeholderLines) == 0 {
		// Roll back the empty pin-session. Root the teardown in context.Background():
		// Pin's ctx may already be at/near its deadline, and KillSessionCtx wraps the
		// passed ctx with WithTimeout — a cancelled parent would make the kill a no-op
		// and orphan the session (the same reason relay.go roots teardown in Background).
		_ = KillSessionCtx(context.Background(), server, pinSession)
		if err != nil {
			return fmt.Errorf("read pin placeholder window: %w", err)
		}
		return fmt.Errorf("read pin placeholder window: pin-session %q reported no windows", pinSession)
	}
	placeholderID := strings.TrimSpace(placeholderLines[0])

	// STAMP-BEFORE-MOVE: write all three membership vars onto the (still empty)
	// pin-session BEFORE moving the target window in. Ordering is load-bearing for
	// crash/failure safety:
	//   - The window has NOT moved yet, so a stamp failure strands nothing — we
	//     simply kill the empty placeholder-only pin-session and return; the window
	//     is untouched in its home session.
	//   - Once the move succeeds (below), @rk_home is already durably present, so
	//     the window can ALWAYS be unpinned. There is no window-moved-but-unstamped
	//     window, hence no double-fault rollback, no "un-unpinnable" pin-session,
	//     and the idempotent recovery story is trivially true.
	stampRollback := func(cause error, opt string) error {
		_ = KillSessionCtx(context.Background(), server, pinSession)
		return fmt.Errorf("set %s on new pin %q: %w", opt, pinSession, cause)
	}
	if err := setSessionOption(ctx, server, pinSession, HomeOption, home); err != nil {
		return stampRollback(err, HomeOption)
	}
	if err := setSessionOption(ctx, server, pinSession, BoardOption, board); err != nil {
		return stampRollback(err, BoardOption)
	}
	if err := setSessionOption(ctx, server, pinSession, BoardOrderOption, orderKey); err != nil {
		return stampRollback(err, BoardOrderOption)
	}

	// Now move the window in. The pin-session is fully stamped, so a successful
	// move yields a complete, unpinnable pin. A move FAILURE strands nothing (the
	// window stays home) — roll back the stamped-but-windowless pin-session.
	if err := MoveWindowToSession(windowID, pinSession, server); err != nil {
		_ = KillSessionCtx(context.Background(), server, pinSession)
		return fmt.Errorf("move window into pin session: %w", err)
	}
	if _, err := tmuxExecServer(ctx, server, "kill-window", "-t", placeholderID); err != nil {
		// Non-fatal: a stray placeholder is cosmetic, but log it loudly. The pin is
		// already valid (window moved, vars stamped) — a leftover placeholder window
		// in the pin-session does not affect board derivation or unpin.
		slog.Warn("board: pin placeholder kill failed", "server", server, "pin", pinSession, "placeholder", placeholderID, "err", err)
	}
	return nil
}

// Unpin restores the pinned window to its remembered home session and removes
// the pin-session. If the home session was killed while the window was pinned,
// it is recreated with the moved window as its only window. The window is
// appended at tmux's next free index in the home session (no original-position
// restore).
//
// Idempotent: a missing pin-session is a silent success.
func Unpin(ctx context.Context, server, windowID, board string) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	if !ValidWindowID(windowID) {
		return fmt.Errorf("invalid window id")
	}
	if !ValidBoardName(board) {
		return fmt.Errorf("invalid board name")
	}
	pinSession, ok := PinSessionName(windowID)
	if !ok {
		return fmt.Errorf("invalid window id")
	}

	// Idempotency: no pin-session → nothing to unpin.
	if _, err := tmuxExecRawServer(ctx, server, "has-session", "-t", ExactSessionTarget(pinSession)); err != nil {
		return nil
	}

	// Board-match guard: only unpin if the pin actually belongs to the requested
	// board. A mismatched `/api/boards/{name}/unpin` (stale or wrong board name)
	// must NOT silently unpin the window AND must not cause the handler to emit a
	// `board-changed` event referencing a board the window was never on. Treat a
	// mismatch as a no-op success — the window stays pinned to its real board, and
	// the handler's broadcast (which names the URL board) describes a state that
	// did not change, so suppressing the unpin keeps SSE consistent. An unreadable
	// @rk_board is a real error.
	curBoard, err := showSessionOption(ctx, server, pinSession, BoardOption)
	if err != nil {
		return fmt.Errorf("read %s: %w", BoardOption, err)
	}
	if curBoard != board {
		return nil
	}

	home, err := showSessionOption(ctx, server, pinSession, HomeOption)
	if err != nil {
		return fmt.Errorf("read %s: %w", HomeOption, err)
	}

	homeAlive := false
	if home != "" {
		if _, err := tmuxExecRawServer(ctx, server, "has-session", "-t", ExactSessionTarget(home)); err == nil {
			homeAlive = true
		}
	}

	if homeAlive {
		// Move the window back into the live home session (tmux appends it).
		// Moving the pin-session's SOLE window out may auto-destroy the now-empty
		// pin-session (tmux's default exit-empty behaviour), so a subsequent
		// kill-session would report "can't find session" — which IS the desired
		// end state. killPinSessionIfPresent tolerates that.
		if err := MoveWindowToSession(windowID, home, server); err != nil {
			return fmt.Errorf("restore window to home %q: %w", home, err)
		}
		return killPinSessionIfPresent(ctx, server, pinSession)
	}

	// No recorded @rk_home. With stamp-before-move (see Pin) this should be
	// unreachable — @rk_home is durably set before the window ever enters the
	// pin-session — but a legacy/corrupt pin-session could still lack it. Rather
	// than hard-failing and stranding the window invisibly (it is filtered from
	// SESSIONS as a `_rk-pin-*` name and, once we strip membership, also from
	// BOARDS), RECOVER it: rename the pin-session to a deterministic recovered
	// home name so the window resurfaces in the SESSIONS sidebar. A window is
	// never left unrecoverable.
	if home == "" {
		recovered := "recovered" + strings.TrimPrefix(pinSession, PinSessionPrefix)
		slog.Warn("board: unpin found pin-session with no @rk_home — recovering window into a renamed session",
			"server", server, "pin", pinSession, "recovered", recovered)
		if err := RenameSession(pinSession, recovered, server); err != nil {
			return fmt.Errorf("recover window from @rk_home-less pin %q: %w", pinSession, err)
		}
		_, _ = tmuxExecRawServer(ctx, server, "set-option", "-u", "-t", ExactSessionTarget(recovered), BoardOption)
		_, _ = tmuxExecRawServer(ctx, server, "set-option", "-u", "-t", ExactSessionTarget(recovered), BoardOrderOption)
		return nil
	}
	// Home is gone — recreate it by renaming the (single-window) pin-session to
	// the home name.
	// This preserves the window as the sole window of the recreated home session
	// with no placeholder, and atomically removes the `_rk-pin-*` name.
	if err := RenameSession(pinSession, home, server); err != nil {
		return fmt.Errorf("recreate home %q from pin session: %w", home, err)
	}
	// Clear the membership vars left on the now-renamed session so a future read
	// does not mistake the recreated home for a pin.
	_, _ = tmuxExecRawServer(ctx, server, "set-option", "-u", "-t", ExactSessionTarget(home), BoardOption)
	_, _ = tmuxExecRawServer(ctx, server, "set-option", "-u", "-t", ExactSessionTarget(home), HomeOption)
	_, _ = tmuxExecRawServer(ctx, server, "set-option", "-u", "-t", ExactSessionTarget(home), BoardOrderOption)
	return nil
}

// killPinSessionIfPresent kills the pin-session, treating an
// already-gone session ("can't find session" / "session not found") as success.
// Moving a single-window pin-session's only window out can auto-destroy the
// empty session under tmux's default exit-empty behaviour, so the explicit kill
// is best-effort cleanup, not a hard requirement.
func killPinSessionIfPresent(ctx context.Context, server, pinSession string) error {
	if _, err := tmuxExecRawServer(ctx, server, "has-session", "-t", ExactSessionTarget(pinSession)); err != nil {
		// Already gone (auto-destroyed) — the desired end state.
		return nil
	}
	return KillSessionCtx(ctx, server, pinSession)
}

// Reorder updates the order key of an existing pin by rewriting only its
// pin-session's @rk_board_order var. Returns an error if the pin-session does
// not exist, is not on the named board, or newOrderKey is invalid.
func Reorder(ctx context.Context, server, windowID, board, newOrderKey string) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	if !ValidWindowID(windowID) {
		return fmt.Errorf("invalid window id")
	}
	if !ValidBoardName(board) {
		return fmt.Errorf("invalid board name")
	}
	if !ValidOrderKey(newOrderKey) {
		return fmt.Errorf("invalid order key")
	}
	pinSession, ok := PinSessionName(windowID)
	if !ok {
		return fmt.Errorf("invalid window id")
	}
	if _, err := tmuxExecRawServer(ctx, server, "has-session", "-t", ExactSessionTarget(pinSession)); err != nil {
		return fmt.Errorf("entry not found")
	}
	current, err := showSessionOption(ctx, server, pinSession, BoardOption)
	if err != nil {
		return err
	}
	if current != board {
		return fmt.Errorf("entry not found")
	}
	return setSessionOption(ctx, server, pinSession, BoardOrderOption, newOrderKey)
}

// ComputeOrderKey returns a key strictly between `before` and `after` in
// lexicographic order, using the lowercase a-z alphabet. Either or both
// neighbours may be empty: `before == ""` means prepend, `after == ""` means
// append.
//
// Invariants:
//   - The returned key satisfies before < key < after (lexicographic) when both
//     neighbours are non-empty; the comparison is one-sided otherwise.
//   - The key never renumbers existing entries; insertion is always between
//     the supplied neighbours.
//
// Algorithm: walk both keys in lockstep. Find the first depth at which a
// strictly-between letter exists. Otherwise descend by appending the prefix
// of `before` and an `m` suffix as a midpoint (extension).
func ComputeOrderKey(before, after string) (string, error) {
	// Validate neighbours: empty or pattern-conformant.
	if before != "" && !ValidOrderKey(before) {
		return "", fmt.Errorf("invalid before key")
	}
	if after != "" && !ValidOrderKey(after) {
		return "", fmt.Errorf("invalid after key")
	}
	if before != "" && after != "" && before >= after {
		return "", fmt.Errorf("before must be lexicographically less than after")
	}

	const minByte = byte('a')
	const maxByte = byte('z')

	// Special-case prepend / append based on the neighbour at depth 0.
	if before == "" {
		// Need a key < after. Try one letter less than after[0].
		if len(after) == 0 {
			return initialAppendKey, nil
		}
		first := after[0]
		if first > minByte {
			return string([]byte{first - 1}), nil
		}
		// after starts with 'a'. Any key starting with 'a' is either equal
		// to "a" or greater (because "a" is a prefix); shorter keys would
		// also need to be < "a" which is impossible in [a-z]+. The only
		// resolution is to renumber — which is forbidden — so we error.
		// Callers should pick "a" or higher for the first slot to avoid
		// running into this; nextAppendKey starts at "m" for that reason.
		return "", fmt.Errorf("cannot generate key strictly less than %q", after)
	}
	if after == "" {
		// Need a key > before. Try one letter more than before[0].
		first := before[0]
		if first < maxByte {
			// Greater first letter is unconditionally greater regardless of
			// before's tail, so a single letter suffices.
			return string([]byte{first + 1}), nil
		}
		// before starts with 'z' — descend, finding a key > before[1:].
		inner, err := ComputeOrderKey(before[1:], "")
		if err != nil {
			return "", err
		}
		// Returned key when stacked under 'z' must still preserve > before.
		// 'z' + inner > 'z' + before[1:] iff inner > before[1:], which the
		// recursive call guarantees.
		if len(before) >= 16 {
			return "", fmt.Errorf("order key length exceeded")
		}
		return "z" + inner, nil
	}

	// Both neighbours present. Walk the shared prefix.
	i := 0
	for i < len(before) && i < len(after) && before[i] == after[i] {
		i++
	}
	prefix := before[:i]

	var bChar byte
	if i < len(before) {
		bChar = before[i]
	} else {
		// `before` is a prefix of `after`. We need before < key < after, with
		// key starting with `prefix` and continuing differently. Drop into the
		// "append after `before`" branch with after[i:].
		// The new key starts with prefix; the next char must be a letter that
		// stays strictly less than after[i] (since after has more chars).
		// Equivalently, we need a key > "" but strictly less than after[i:].
		// after[i:] is non-empty here.
		afterTail := after[i:]
		// Recurse: need key in ("", afterTail). If afterTail[0] > 'a', use
		// afterTail[0]-1. Otherwise zero-pad with 'a'.
		inner, err := ComputeOrderKey("", afterTail)
		if err != nil {
			return "", err
		}
		if len(prefix)+len(inner) > 16 {
			return "", fmt.Errorf("order key length exceeded")
		}
		return prefix + inner, nil
	}

	var aChar byte
	if i < len(after) {
		aChar = after[i]
	} else {
		// `after` is a prefix of `before`. Cannot happen because before < after
		// implies after is not a prefix of before unless they're equal, which
		// the earlier check rejects.
		return "", fmt.Errorf("after is a prefix of before")
	}

	// Letters at depth i are bChar < aChar.
	if aChar-bChar > 1 {
		// At least one letter strictly between — pick the midpoint.
		mid := bChar + (aChar-bChar)/2
		if len(prefix)+1 > 16 {
			return "", fmt.Errorf("order key length exceeded")
		}
		return prefix + string([]byte{mid}), nil
	}

	// aChar == bChar+1: no letter fits at this depth. Strategy: extend `before`
	// with a key strictly greater than before[i+1:] (open-ended on the right).
	// The new key is prefix + bChar + extension; this is < prefix + aChar +
	// anything = `after`-prefix.
	tail := before[i+1:]
	inner, err := ComputeOrderKey(tail, "")
	if err != nil {
		return "", err
	}
	if len(prefix)+1+len(inner) > 16 {
		return "", fmt.Errorf("order key length exceeded")
	}
	return prefix + string([]byte{bChar}) + inner, nil
}
