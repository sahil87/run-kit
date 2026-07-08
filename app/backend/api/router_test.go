package api

import (
	"context"
	"errors"
	"testing"

	"rk/internal/tmux"
)

// TestLookupNeighbourKeys_crossServer covers R7: the reorder neighbour lookup
// must resolve before/after windowIDs against the board's entries aggregated
// across ALL servers, not only the moved pane's own server. On a mixed-server
// board a move whose new neighbour was pinned from a DIFFERENT server must still
// resolve (previously returned errNeighbourNotFound → 400, permanently
// desyncing the optimistic preview).
func TestLookupNeighbourKeys_crossServer(t *testing.T) {
	// Board "main" spans two servers: a,c on s1 and b on s2, ordered a<b<c.
	ops := &mockTmuxOps{
		listServersResult: []string{"s1", "s2"},
		listBoardEntriesByServer: map[string][]tmux.BoardEntry{
			"s1": {
				{Server: "s1", WindowID: "@1", Board: "main", OrderKey: "a"},
				{Server: "s1", WindowID: "@3", Board: "main", OrderKey: "c"},
			},
			"s2": {
				{Server: "s2", WindowID: "@2", Board: "main", OrderKey: "b"},
			},
		},
	}

	// Move @3 (s1) between @1 (s1) and @2 (s2): the AFTER neighbour lives on a
	// different server than the moved pane. Must resolve, not 400.
	beforeKey, afterKey, err := lookupNeighbourKeys(context.Background(), ops, "main", "@1", "@2")
	if err != nil {
		t.Fatalf("cross-server neighbour lookup failed: %v", err)
	}
	if beforeKey != "a" {
		t.Errorf("beforeKey = %q, want %q (from s1)", beforeKey, "a")
	}
	if afterKey != "b" {
		t.Errorf("afterKey = %q, want %q (from the OTHER server s2)", afterKey, "b")
	}

	// The minted key must sit strictly between the neighbours' keys.
	newKey, err := tmux.ComputeOrderKey(beforeKey, afterKey)
	if err != nil {
		t.Fatalf("ComputeOrderKey(%q,%q): %v", beforeKey, afterKey, err)
	}
	if !(beforeKey < newKey && newKey < afterKey) {
		t.Errorf("newKey %q not strictly between %q and %q", newKey, beforeKey, afterKey)
	}
}

// TestLookupNeighbourKeys_trulyAbsent_400 keeps the negative case: a neighbour
// windowID absent from the board on EVERY server still yields
// errNeighbourNotFound (→ 400 at the handler).
func TestLookupNeighbourKeys_trulyAbsent(t *testing.T) {
	ops := &mockTmuxOps{
		listServersResult: []string{"s1", "s2"},
		listBoardEntriesByServer: map[string][]tmux.BoardEntry{
			"s1": {{Server: "s1", WindowID: "@1", Board: "main", OrderKey: "a"}},
			"s2": {{Server: "s2", WindowID: "@2", Board: "main", OrderKey: "b"}},
		},
	}

	// @999 exists on no server for this board → not found.
	_, _, err := lookupNeighbourKeys(context.Background(), ops, "main", "@1", "@999")
	if !errors.Is(err, errNeighbourNotFound) {
		t.Fatalf("err = %v, want errNeighbourNotFound", err)
	}
}

// TestLookupNeighbourKeys_nullNeighbours covers prepend/append: empty neighbour
// IDs resolve to empty keys (the fractional-index prepend/append sentinels)
// without touching the entry map.
func TestLookupNeighbourKeys_nullNeighbours(t *testing.T) {
	ops := &mockTmuxOps{
		listServersResult: []string{"s1"},
		listBoardEntriesByServer: map[string][]tmux.BoardEntry{
			"s1": {{Server: "s1", WindowID: "@1", Board: "main", OrderKey: "m"}},
		},
	}

	beforeKey, afterKey, err := lookupNeighbourKeys(context.Background(), ops, "main", "", "")
	if err != nil {
		t.Fatalf("null-neighbour lookup failed: %v", err)
	}
	if beforeKey != "" || afterKey != "" {
		t.Errorf("beforeKey=%q afterKey=%q, want both empty", beforeKey, afterKey)
	}
}

// TestLookupNeighbourKeys_ignoresOtherBoards ensures a neighbour windowID that
// belongs to a DIFFERENT board (even on the same server) is not treated as a
// match — the board name scopes the aggregation.
func TestLookupNeighbourKeys_ignoresOtherBoards(t *testing.T) {
	ops := &mockTmuxOps{
		listServersResult: []string{"s1"},
		listBoardEntriesByServer: map[string][]tmux.BoardEntry{
			"s1": {
				{Server: "s1", WindowID: "@1", Board: "main", OrderKey: "a"},
				{Server: "s1", WindowID: "@2", Board: "other", OrderKey: "b"},
			},
		},
	}

	// @2 is on board "other", so for board "main" it is absent → not found.
	_, _, err := lookupNeighbourKeys(context.Background(), ops, "main", "@1", "@2")
	if !errors.Is(err, errNeighbourNotFound) {
		t.Fatalf("err = %v, want errNeighbourNotFound (neighbour on a different board)", err)
	}
}
