package tmux

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
)

// BoardOption is the tmux server-scoped user option that stores the
// per-server pin membership of pane boards. The stored value is a
// comma-separated list of `<windowID>:<board>:<orderKey>` entries.
const BoardOption = "@rk_board"

// boardEntrySep separates entries within the @rk_board value. boardFieldSep
// separates fields within an entry. Both are reserved characters and rejected
// in board-name validation.
const (
	boardEntrySep = ","
	boardFieldSep = ":"
)

// BoardEntry represents a single (server, windowID) pin to a named board.
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
// Pattern: alphanumeric + hyphen + underscore, length 1-32. The reserved
// separator characters `,` and `:` are excluded by the pattern.
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

// parseBoardValue parses the raw @rk_board option value into entries. The
// supplied server is attached to each entry. Malformed entries are skipped
// with a warning log; valid entries are returned unsorted.
func parseBoardValue(server, raw string) []BoardEntry {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, boardEntrySep)
	out := make([]BoardEntry, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		fields := strings.Split(p, boardFieldSep)
		if len(fields) != 3 {
			slog.Warn("board: malformed @rk_board entry (field count)", "server", server, "entry", p)
			continue
		}
		windowID := strings.TrimSpace(fields[0])
		board := strings.TrimSpace(fields[1])
		orderKey := strings.TrimSpace(fields[2])
		if !ValidWindowID(windowID) || !ValidBoardName(board) || !ValidOrderKey(orderKey) {
			slog.Warn("board: malformed @rk_board entry (invalid field)", "server", server, "entry", p)
			continue
		}
		out = append(out, BoardEntry{
			Server:   server,
			WindowID: windowID,
			Board:    board,
			OrderKey: orderKey,
		})
	}
	return out
}

// serializeBoardValue produces the canonical @rk_board option value for a
// slice of entries. Server is implicit (per-server option), so it is not
// included in the serialized form.
func serializeBoardValue(entries []BoardEntry) string {
	if len(entries) == 0 {
		return ""
	}
	parts := make([]string, 0, len(entries))
	for _, e := range entries {
		parts = append(parts, e.WindowID+boardFieldSep+e.Board+boardFieldSep+e.OrderKey)
	}
	return strings.Join(parts, boardEntrySep)
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

// ListBoardEntries returns the pinned-window entries stored on the named
// server. Returns ([]BoardEntry{}, nil) when the option is unset or the
// server is not reachable — these are normal operational states.
func ListBoardEntries(ctx context.Context, server string) ([]BoardEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	out, err := tmuxExecRawServer(ctx, server, "show-option", "-sv", BoardOption)
	if err != nil {
		if isAbsentOption(err) {
			return []BoardEntry{}, nil
		}
		return nil, fmt.Errorf("read %s on %s: %w", BoardOption, server, err)
	}
	entries := parseBoardValue(server, out)
	if entries == nil {
		return []BoardEntry{}, nil
	}
	return entries, nil
}

// ListAllBoardEntries aggregates entries from every reachable server.
func ListAllBoardEntries(ctx context.Context) ([]BoardEntry, error) {
	servers, err := ListServers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list servers: %w", err)
	}
	if len(servers) == 0 {
		// No reachable servers — also try "default" since it may not have a socket file yet.
		servers = []string{"default"}
	}
	all := make([]BoardEntry, 0)
	for _, s := range servers {
		entries, lerr := ListBoardEntries(ctx, s)
		if lerr != nil {
			slog.Warn("board: ListBoardEntries failed", "server", s, "err", lerr)
			continue
		}
		all = append(all, entries...)
	}
	return all, nil
}

// ListBoards returns the alphabetical summary across all servers.
func ListBoards(ctx context.Context) ([]BoardSummary, error) {
	entries, err := ListAllBoardEntries(ctx)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	for _, e := range entries {
		counts[e.Board]++
	}
	out := make([]BoardSummary, 0, len(counts))
	for name, count := range counts {
		out = append(out, BoardSummary{Name: name, PinCount: count})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// liveWindowIDs returns the set of window IDs currently present on the named
// server. Returns nil with nil error when the server is unreachable.
func liveWindowIDs(ctx context.Context, server string) (map[string]bool, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	out, err := tmuxExecRawServer(ctx, server, "list-windows", "-a", "-F", "#{window_id}")
	if err != nil {
		if isAbsentOption(err) {
			return map[string]bool{}, nil
		}
		return nil, fmt.Errorf("list-windows on %s: %w", server, err)
	}
	set := make(map[string]bool)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			set[line] = true
		}
	}
	return set, nil
}

// GetBoard returns entries for a single board across all servers, sorted by
// order key. Stale entries (windows that no longer exist on their source
// server) are dropped from the response and best-effort write-back to
// @rk_board on each affected server. Write-back failures do NOT fail the
// read; they are logged and the cleaned slice is returned.
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
		live, werr := liveWindowIDs(ctx, s)
		if werr != nil {
			slog.Warn("board: liveWindowIDs failed", "server", s, "err", werr)
			// Without live data we can't safely drop stale entries — return what we have.
			for _, e := range entries {
				if e.Board == name {
					out = append(out, e)
				}
			}
			continue
		}
		// Split into kept-on-server (all boards) and matching-this-board.
		kept := entries[:0:len(entries)]
		var dropped bool
		for _, e := range entries {
			if !live[e.WindowID] {
				dropped = true
				continue
			}
			kept = append(kept, e)
			if e.Board == name {
				out = append(out, e)
			}
		}
		if dropped {
			// Best-effort write-back of the cleaned slice.
			if werr := setBoardValue(ctx, s, kept); werr != nil {
				slog.Warn("board: stale-cleanup write-back failed", "server", s, "err", werr)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].OrderKey < out[j].OrderKey })
	return out, nil
}

// setBoardValue writes the entries slice as the @rk_board option on the named
// server. An empty slice unsets the option (set -u) so the absent state is
// canonical.
func setBoardValue(ctx context.Context, server string, entries []BoardEntry) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	if len(entries) == 0 {
		_, err := tmuxExecRawServer(ctx, server, "set-option", "-su", BoardOption)
		return err
	}
	value := serializeBoardValue(entries)
	_, err := tmuxExecRawServer(ctx, server, "set-option", "-s", BoardOption, value)
	return err
}

// initialAppendKey is the first order key assigned when a board has no
// entries. Using a midpoint letter leaves headroom for both prepend and
// append operations, which is important since the alphabet has no
// representation strictly less than "a".
const initialAppendKey = "m"

// nextAppendKey returns an order key strictly greater than the largest
// existing key in entries (lexicographic). Empty list → initialAppendKey.
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
		// Fall back to extending with 'a'.
		return maxKey + "a"
	}
	return next
}

// Pin adds an entry for (server, windowID, board) with a fresh order key.
// Idempotent: returns nil with no mutation if the same (windowID, board)
// already exists on the server.
func Pin(ctx context.Context, server, windowID, board string) error {
	if !ValidWindowID(windowID) {
		return fmt.Errorf("invalid window id")
	}
	if !ValidBoardName(board) {
		return fmt.Errorf("invalid board name")
	}
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		return err
	}
	// Idempotency: same window already pinned to this board is a no-op.
	for _, e := range entries {
		if e.WindowID == windowID && e.Board == board {
			return nil
		}
	}
	// Compute the next append key restricted to this board, so order keys are
	// monotonic within the board (cross-board reuse is fine).
	boardEntries := make([]BoardEntry, 0)
	for _, e := range entries {
		if e.Board == board {
			boardEntries = append(boardEntries, e)
		}
	}
	newKey := nextAppendKey(boardEntries)
	entries = append(entries, BoardEntry{
		Server:   server,
		WindowID: windowID,
		Board:    board,
		OrderKey: newKey,
	})
	return setBoardValue(ctx, server, entries)
}

// Unpin removes the entry matching (windowID, board) on the given server.
// Idempotent: silently succeeds if the entry is not present.
func Unpin(ctx context.Context, server, windowID, board string) error {
	if !ValidWindowID(windowID) {
		return fmt.Errorf("invalid window id")
	}
	if !ValidBoardName(board) {
		return fmt.Errorf("invalid board name")
	}
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		return err
	}
	out := entries[:0:len(entries)]
	changed := false
	for _, e := range entries {
		if e.WindowID == windowID && e.Board == board {
			changed = true
			continue
		}
		out = append(out, e)
	}
	if !changed {
		return nil
	}
	return setBoardValue(ctx, server, out)
}

// Reorder updates the order key of an existing entry. Returns an error if
// the entry is not found or newOrderKey is invalid.
func Reorder(ctx context.Context, server, windowID, board, newOrderKey string) error {
	if !ValidWindowID(windowID) {
		return fmt.Errorf("invalid window id")
	}
	if !ValidBoardName(board) {
		return fmt.Errorf("invalid board name")
	}
	if !ValidOrderKey(newOrderKey) {
		return fmt.Errorf("invalid order key")
	}
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		return err
	}
	found := false
	for i, e := range entries {
		if e.WindowID == windowID && e.Board == board {
			entries[i].OrderKey = newOrderKey
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("entry not found")
	}
	return setBoardValue(ctx, server, entries)
}

// RemoveAllByWindowID removes every entry whose window_id matches the
// supplied id from the named server's @rk_board, returning the list of
// board names that lost entries (deduplicated, sorted alphabetically).
// Idempotent: empty result + nil error if no entries matched.
func RemoveAllByWindowID(ctx context.Context, server, windowID string) ([]string, error) {
	if !ValidWindowID(windowID) {
		return nil, fmt.Errorf("invalid window id")
	}
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		return nil, err
	}
	out := entries[:0:len(entries)]
	boardSet := make(map[string]struct{})
	for _, e := range entries {
		if e.WindowID == windowID {
			boardSet[e.Board] = struct{}{}
			continue
		}
		out = append(out, e)
	}
	if len(boardSet) == 0 {
		return nil, nil
	}
	if err := setBoardValue(ctx, server, out); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(boardSet))
	for n := range boardSet {
		names = append(names, n)
	}
	sort.Strings(names)
	return names, nil
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
