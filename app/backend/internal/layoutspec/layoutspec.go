// Package layoutspec is the Go port of the frontend's surface-layout grammar
// (app/frontend/src/lib/surface-layout.ts parseLayout/serializeLayout): the
// "@rk_win_layout" value is "<shape>:<surface>[,<surface>…]" and both the
// /options validator and the CLI share this one table so they cannot drift
// from the frontend's parser. The package is pure — no tmux, no I/O.
package layoutspec

import (
	"fmt"
	"strings"
)

// Layout is a parsed layout value: which preset arrangement (Shape) and which
// surfaces occupy its slots (Order — Order[0] is slot A, the main slot in
// main-* shapes). A layout carries exactly its shape's arity of surfaces;
// kinds never repeat within one layout EXCEPT tty (duplicate tty tiles of the
// same window are legal — the muxed relay supports N clients per pane).
type Layout struct {
	Shape string
	Order []string
}

// shapeArity is the fixed slot count per shape (spec: shape arity is fixed).
var shapeArity = map[string]int{
	"single":     1,
	"split-h":    2,
	"split-v":    2,
	"row":        3,
	"col":        3,
	"main-left":  3,
	"main-right": 3,
	"main-top":   3,
}

// surfaceKinds is the closed surface registry — the frontend's ViewName set;
// spec'd-but-unshipped surfaces (desktop, agents) are rejected until the
// frontend ships them, and extending the registry is appending one entry.
var surfaceKinds = map[string]bool{
	"tty":  true,
	"web":  true,
	"chat": true,
	"code": true,
}

// Parse validates "<shape>:<a>,<b>[,<c>]" and returns the Layout. Untrusted
// strings (tmux option values, API bodies) are validated HERE so callers may
// pass raw values. Anything malformed — unknown shape, unknown surface, wrong
// arity for the shape, a repeated non-tty surface — is an error.
func Parse(raw string) (Layout, error) {
	shape, rest, found := strings.Cut(raw, ":")
	if !found {
		return Layout{}, fmt.Errorf("layout %q: must be <shape>:<surface,…>", raw)
	}
	arity, ok := shapeArity[shape]
	if !ok {
		return Layout{}, fmt.Errorf("layout %q: unknown shape %q", raw, shape)
	}
	order := strings.Split(rest, ",")
	if len(order) != arity {
		return Layout{}, fmt.Errorf("layout %q: shape %q takes %d surfaces, got %d", raw, shape, arity, len(order))
	}
	seen := map[string]bool{}
	for _, surface := range order {
		if !surfaceKinds[surface] {
			return Layout{}, fmt.Errorf("layout %q: unknown surface %q", raw, surface)
		}
		if surface == "tty" {
			continue // duplicate tty tiles are legal (muxed relay)
		}
		if seen[surface] {
			return Layout{}, fmt.Errorf("layout %q: surface %q repeats", raw, surface)
		}
		seen[surface] = true
	}
	return Layout{Shape: shape, Order: order}, nil
}

// String serializes the layout back to its exact option-value form
// (round-trips byte-identically with Parse).
func (l Layout) String() string {
	return l.Shape + ":" + strings.Join(l.Order, ",")
}

// Has reports whether the layout's order contains the surface.
func (l Layout) Has(surface string) bool {
	for _, s := range l.Order {
		if s == surface {
			return true
		}
	}
	return false
}
