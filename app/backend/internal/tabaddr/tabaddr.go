// Package tabaddr parses the tab-relative address grammar
// `@N[/<surface>[/<n>]]` (docs/specs/ui-state.md § Addressing Grammar) into a
// structured Addr. The package is pure — no tmux, no I/O — so the CLI verbs
// can classify malformed input as usage errors (exit 2) before any tmux call.
// The surrounding `-L <server>` / `=session:window` qualifiers are resolved by
// cmd/rk, not here.
package tabaddr

import (
	"fmt"
	"strconv"
	"strings"

	"rk/internal/layoutspec"
	"rk/internal/tmux"
	"rk/internal/validate"
)

// Addr is a parsed tab address. WindowID is "" when the caller omitted @N
// (own-tab default — resolved by cmd/rk, never here). Surface is "" when no
// surface segment was given; Index is 0 when no <n> segment was given.
type Addr struct {
	WindowID string // "@N" or ""
	Surface  string // "web" | "tty" | "code" | "chat" | ""
	Index    int    // 1-based; 0 = absent
}

// Parse accepts: "" (empty Addr), "@12", "@12/web", "@12/web/3", "web",
// "web/3", and a bare integer "3" (shorthand for web/<n> on the caller's own
// tab). "@N" uses validate.ValidateWindowID; a surface segment must be a
// layoutspec surface kind; <n> is legal only after "web" (the only surface
// with sub-addresses) and must satisfy 1 ≤ n ≤ tmux.MaxWebTabs — the bound is
// checked at parse time so callers get a usage error for "@1/web/9", not a
// tmux error. Anything else — a fourth segment, an empty segment, "@1/tty/2"
// — is an error.
func Parse(s string) (Addr, error) {
	if s == "" {
		return Addr{}, nil
	}
	segments := strings.Split(s, "/")
	if len(segments) > 3 {
		return Addr{}, fmt.Errorf("invalid tab address %q: too many segments (want @N[/<surface>[/<n>]])", s)
	}
	for _, seg := range segments {
		if seg == "" {
			return Addr{}, fmt.Errorf("invalid tab address %q: empty segment", s)
		}
	}

	var a Addr
	pos := 0
	if strings.HasPrefix(segments[0], "@") {
		if errMsg := validate.ValidateWindowID(segments[0], "Window ID"); errMsg != "" {
			return Addr{}, fmt.Errorf("invalid tab address %q: %s", s, errMsg)
		}
		a.WindowID = segments[0]
		pos++
	}

	if pos < len(segments) {
		surface := segments[pos]
		if n, err := strconv.Atoi(surface); err == nil && pos == 0 {
			// A bare integer is shorthand for web/<n> on the own tab.
			if n < 1 || n > tmux.MaxWebTabs {
				return Addr{}, fmt.Errorf("invalid tab address %q: <n> out of range 1..%d", s, tmux.MaxWebTabs)
			}
			a.Surface = "web"
			a.Index = n
			pos++
		} else {
			if !layoutspec.IsSurface(surface) {
				return Addr{}, fmt.Errorf("invalid tab address %q: unknown surface %q", s, surface)
			}
			a.Surface = surface
			pos++
		}
	}

	if pos < len(segments) {
		if a.Surface != "web" {
			return Addr{}, fmt.Errorf("invalid tab address %q: only web carries an <n> segment", s)
		}
		n, err := strconv.Atoi(segments[pos])
		if err != nil {
			return Addr{}, fmt.Errorf("invalid tab address %q: <n> must be an integer", s)
		}
		if n < 1 || n > tmux.MaxWebTabs {
			return Addr{}, fmt.Errorf("invalid tab address %q: <n> out of range 1..%d", s, tmux.MaxWebTabs)
		}
		a.Index = n
		pos++
	}

	// Index 0 means "absent" on Addr, so both index-bearing paths range-check
	// at assignment (above) rather than on the field afterwards.
	return a, nil
}

// String serializes the address back to its exact input form (round-trips
// with Parse): "@12/web/3", "@12/web", "@12", "web/3", "web", "3" (bare index
// on the own tab), "" (empty Addr).
func (a Addr) String() string {
	var b strings.Builder
	b.WriteString(a.WindowID)
	if a.Surface != "" {
		if a.WindowID != "" {
			b.WriteByte('/')
		}
		b.WriteString(a.Surface)
	}
	if a.Index != 0 {
		if a.Surface != "" || a.WindowID != "" {
			b.WriteByte('/')
		}
		b.WriteString(strconv.Itoa(a.Index))
	}
	return b.String()
}
