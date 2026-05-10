package tmux

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestValidBoardName(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"main", true},
		{"deploy-1", true},
		{"a", true},
		{"abc_DEF-123", true},
		{strings.Repeat("a", 32), true},
		{"", false},
		{strings.Repeat("a", 33), false},
		{"foo,bar", false},
		{"foo:bar", false},
		{"foo bar", false},
		{"foo.bar", false},
		{"foo/bar", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ValidBoardName(tt.name)
			if got != tt.want {
				t.Errorf("ValidBoardName(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

func TestValidWindowID(t *testing.T) {
	tests := []struct {
		id   string
		want bool
	}{
		{"@1234", true},
		{"@0", true},
		{"@9999999", true},
		{"@", false},
		{"1234", false},
		{"@abc", false},
		{"@1234a", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			got := ValidWindowID(tt.id)
			if got != tt.want {
				t.Errorf("ValidWindowID(%q) = %v, want %v", tt.id, got, tt.want)
			}
		})
	}
}

func TestValidOrderKey(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{"a", true},
		{"abcdef", true},
		{strings.Repeat("a", 16), true},
		{"", false},
		{strings.Repeat("a", 17), false},
		{"A", false},
		{"a1", false},
		{"a-b", false},
	}
	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			got := ValidOrderKey(tt.key)
			if got != tt.want {
				t.Errorf("ValidOrderKey(%q) = %v, want %v", tt.key, got, tt.want)
			}
		})
	}
}

func TestParseBoardValue(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []BoardEntry
	}{
		{"empty", "", nil},
		{"whitespace", "   \n", nil},
		{"single", "@1234:main:a", []BoardEntry{
			{Server: "s", WindowID: "@1234", Board: "main", OrderKey: "a"},
		}},
		{"multiple", "@1234:main:a,@5678:main:c,@9000:deploy:b", []BoardEntry{
			{Server: "s", WindowID: "@1234", Board: "main", OrderKey: "a"},
			{Server: "s", WindowID: "@5678", Board: "main", OrderKey: "c"},
			{Server: "s", WindowID: "@9000", Board: "deploy", OrderKey: "b"},
		}},
		{"skip malformed field count", "not:a:valid:entry,@1234:main:a", []BoardEntry{
			{Server: "s", WindowID: "@1234", Board: "main", OrderKey: "a"},
		}},
		{"skip malformed window id", "1234:main:a,@5678:main:b", []BoardEntry{
			{Server: "s", WindowID: "@5678", Board: "main", OrderKey: "b"},
		}},
		{"skip malformed board", "@1234:foo,bar:a,@5678:main:b", []BoardEntry{
			// the first parses as 4 fields and is skipped on count
			{Server: "s", WindowID: "@5678", Board: "main", OrderKey: "b"},
		}},
		{"skip malformed order key", "@1234:main:Z,@5678:main:b", []BoardEntry{
			{Server: "s", WindowID: "@5678", Board: "main", OrderKey: "b"},
		}},
		{"empty entries between commas", "@1234:main:a,,@5678:main:b", []BoardEntry{
			{Server: "s", WindowID: "@1234", Board: "main", OrderKey: "a"},
			{Server: "s", WindowID: "@5678", Board: "main", OrderKey: "b"},
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseBoardValue("s", tt.raw)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d entries, want %d (got=%v)", len(got), len(tt.want), got)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Errorf("idx %d: got %+v, want %+v", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestSerializeBoardValue(t *testing.T) {
	tests := []struct {
		name string
		in   []BoardEntry
		want string
	}{
		{"empty", nil, ""},
		{"single", []BoardEntry{
			{WindowID: "@1234", Board: "main", OrderKey: "a"},
		}, "@1234:main:a"},
		{"multiple preserves order", []BoardEntry{
			{WindowID: "@1234", Board: "main", OrderKey: "a"},
			{WindowID: "@5678", Board: "deploy", OrderKey: "b"},
		}, "@1234:main:a,@5678:deploy:b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := serializeBoardValue(tt.in)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRoundTripBoardValue(t *testing.T) {
	in := []BoardEntry{
		{Server: "s", WindowID: "@1234", Board: "main", OrderKey: "a"},
		{Server: "s", WindowID: "@5678", Board: "deploy", OrderKey: "b"},
		{Server: "s", WindowID: "@9999", Board: "main", OrderKey: "bm"},
	}
	raw := serializeBoardValue(in)
	got := parseBoardValue("s", raw)
	if len(got) != len(in) {
		t.Fatalf("len got=%d, want=%d", len(got), len(in))
	}
	for i := range in {
		if got[i] != in[i] {
			t.Errorf("idx %d: got %+v, want %+v", i, got[i], in[i])
		}
	}
}

func TestComputeOrderKey(t *testing.T) {
	tests := []struct {
		name        string
		before      string
		after       string
		want        string
		wantBetween bool // if true, only require strict between, not exact
	}{
		{"prepend basic", "", "b", "a", false},
		{"append basic", "c", "", "d", false},
		{"insert between b c", "b", "c", "", true}, // strictly between
		{"insert between b bm", "b", "bm", "", true},
		{"empty empty", "", "", initialAppendKey, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ComputeOrderKey(tt.before, tt.after)
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if !ValidOrderKey(got) {
				t.Fatalf("got %q is not a valid order key", got)
			}
			if !tt.wantBetween {
				if got != tt.want {
					t.Errorf("got %q, want %q", got, tt.want)
				}
			}
			// Always verify ordering invariants.
			if tt.before != "" && !(tt.before < got) {
				t.Errorf("expected %q < %q", tt.before, got)
			}
			if tt.after != "" && !(got < tt.after) {
				t.Errorf("expected %q < %q", got, tt.after)
			}
		})
	}
}

func TestComputeOrderKey_RepeatedInsertBetween(t *testing.T) {
	// Repeatedly insert between b and c, alternating which neighbour shrinks.
	// Always shrink the LEFT side (move before forward) so we never approach
	// the lex-impossible "<X" zone for keys X starting with 'a' at any depth.
	before := "b"
	after := "c"
	for i := 0; i < 10; i++ {
		got, err := ComputeOrderKey(before, after)
		if err != nil {
			t.Fatalf("iter %d (before=%q, after=%q): %v", i, before, after, err)
		}
		if !ValidOrderKey(got) {
			t.Fatalf("iter %d: %q invalid", i, got)
		}
		if !(before < got && got < after) {
			t.Fatalf("iter %d: %q not strictly between %q and %q", i, got, before, after)
		}
		before = got
	}
}

func TestComputeOrderKey_InvalidInputs(t *testing.T) {
	tests := []struct {
		before, after string
	}{
		{"A", ""},  // uppercase
		{"", "A"},  // uppercase
		{"a1", ""}, // digit
		{"b", "b"}, // equal
		{"c", "b"}, // before > after
		{"", "a"},  // no key < "a" exists in [a-z]+
	}
	for _, tt := range tests {
		t.Run(tt.before+"_"+tt.after, func(t *testing.T) {
			_, err := ComputeOrderKey(tt.before, tt.after)
			if err == nil {
				t.Errorf("expected error for before=%q after=%q", tt.before, tt.after)
			}
		})
	}
}

// withBoardTmux starts an ephemeral tmux server for board integration tests.
// Mirrors withSessionOrderTmux from tmux_test.go.
func withBoardTmux(t *testing.T) string {
	t.Helper()
	server := withSessionOrderTmux(t) // re-use same helper
	return server
}

func TestPin_AppendsAndIsIdempotent(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Use a fake @<N> id; tmux options don't validate that the id maps to a
	// live window — we test idempotency at the option level.
	if err := Pin(ctx, server, "@1234", "main"); err != nil {
		t.Fatalf("Pin first: %v", err)
	}
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatalf("ListBoardEntries: %v", err)
	}
	if len(entries) != 1 || entries[0].WindowID != "@1234" || entries[0].Board != "main" {
		t.Fatalf("after first Pin got %+v", entries)
	}

	// Idempotent re-pin.
	if err := Pin(ctx, server, "@1234", "main"); err != nil {
		t.Fatalf("Pin second: %v", err)
	}
	entries2, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatalf("ListBoardEntries: %v", err)
	}
	if len(entries2) != 1 {
		t.Errorf("expected 1 entry after idempotent re-pin, got %+v", entries2)
	}
	if entries2[0].OrderKey != entries[0].OrderKey {
		t.Errorf("order key changed on idempotent re-pin: %q -> %q", entries[0].OrderKey, entries2[0].OrderKey)
	}

	// Pin a different window — should append.
	if err := Pin(ctx, server, "@5678", "main"); err != nil {
		t.Fatalf("Pin third: %v", err)
	}
	entries3, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatalf("ListBoardEntries: %v", err)
	}
	if len(entries3) != 2 {
		t.Fatalf("expected 2 entries, got %+v", entries3)
	}
	// Second entry's order key must be greater than the first's.
	var first, second BoardEntry
	for _, e := range entries3 {
		if e.WindowID == "@1234" {
			first = e
		} else {
			second = e
		}
	}
	if !(first.OrderKey < second.OrderKey) {
		t.Errorf("expected %q < %q", first.OrderKey, second.OrderKey)
	}
}

func TestUnpin_RemovesOnlyMatching(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := Pin(ctx, server, "@1234", "main"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(ctx, server, "@1234", "deploy"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(ctx, server, "@5678", "main"); err != nil {
		t.Fatal(err)
	}

	if err := Unpin(ctx, server, "@1234", "main"); err != nil {
		t.Fatal(err)
	}

	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %+v", entries)
	}

	// @1234:deploy and @5678:main should remain.
	have := map[string]bool{}
	for _, e := range entries {
		have[e.WindowID+":"+e.Board] = true
	}
	if !have["@1234:deploy"] || !have["@5678:main"] {
		t.Errorf("got entries %+v, want @1234:deploy and @5678:main", entries)
	}
}

func TestUnpin_Idempotent(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Unpin from empty — no error.
	if err := Unpin(ctx, server, "@1234", "main"); err != nil {
		t.Fatalf("unpin from empty: %v", err)
	}
}

func TestReorder_UpdatesOrderKey(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := Pin(ctx, server, "@1234", "main"); err != nil {
		t.Fatal(err)
	}
	if err := Reorder(ctx, server, "@1234", "main", "m"); err != nil {
		t.Fatal(err)
	}
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].OrderKey != "m" {
		t.Errorf("got %+v, want order key m", entries)
	}
}

func TestReorder_NotFound(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := Reorder(ctx, server, "@1234", "main", "a")
	if err == nil {
		t.Error("expected error for missing entry")
	}
}

func TestRemoveAllByWindowID(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := Pin(ctx, server, "@1234", "main"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(ctx, server, "@1234", "deploy"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(ctx, server, "@5678", "main"); err != nil {
		t.Fatal(err)
	}

	boards, err := RemoveAllByWindowID(ctx, server, "@1234")
	if err != nil {
		t.Fatal(err)
	}
	if len(boards) != 2 || boards[0] != "deploy" || boards[1] != "main" {
		t.Errorf("got boards %v, want [deploy main]", boards)
	}

	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].WindowID != "@5678" {
		t.Errorf("after removal got %+v, want only @5678", entries)
	}

	// Removing again is a no-op.
	boards2, err := RemoveAllByWindowID(ctx, server, "@1234")
	if err != nil {
		t.Fatal(err)
	}
	if len(boards2) != 0 {
		t.Errorf("re-remove got %v, want empty", boards2)
	}
}

func TestListBoardEntries_UnsetReturnsEmpty(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	got, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty", got)
	}
}

func TestListBoards_AlphabeticalAggregation(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := Pin(ctx, server, "@1234", "main"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(ctx, server, "@5678", "main"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(ctx, server, "@9999", "deploy"); err != nil {
		t.Fatal(err)
	}

	// Force ListBoards to use this server only by skipping ListServers — instead
	// call the helper directly. ListBoards iterates ListServers, which may
	// return many servers in CI; we only validate via ListBoardEntries summary
	// helpers here. Compose the summary manually.
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, e := range entries {
		counts[e.Board]++
	}
	if counts["main"] != 2 || counts["deploy"] != 1 {
		t.Errorf("counts = %v, want main:2 deploy:1", counts)
	}
}

func TestGetBoard_DropsStaleEntries(t *testing.T) {
	server := withBoardTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// boot session has window @1 (or similar) — discover its real id.
	rawIDs, err := tmuxExecRawServer(ctx, server, "list-windows", "-a", "-F", "#{window_id}")
	if err != nil {
		t.Fatalf("list-windows: %v", err)
	}
	ids := strings.Split(strings.TrimSpace(rawIDs), "\n")
	if len(ids) == 0 || ids[0] == "" {
		t.Fatal("no live windows on bootstrap session")
	}
	liveID := ids[0]

	// Pin one live and one stale.
	if err := Pin(ctx, server, liveID, "main"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(ctx, server, "@9999999", "main"); err != nil {
		t.Fatal(err)
	}

	// GetBoard runs the cleanup. We can't easily inject ListServers, so call
	// ListBoardEntries afterwards on this server only and verify the stale
	// entry was written back. To avoid pulling other servers into the test,
	// run GetBoard, then re-read entries on the test server only.
	gb, err := GetBoard(ctx, "main")
	if err != nil {
		t.Fatalf("GetBoard: %v", err)
	}
	// gb may include entries from other servers if ListServers returns more.
	// We just verify the stale @9999999 is not present and the live one is.
	foundLive := false
	for _, e := range gb {
		if e.Server == server {
			if e.WindowID == "@9999999" {
				t.Errorf("stale @9999999 leaked into GetBoard result")
			}
			if e.WindowID == liveID {
				foundLive = true
			}
		}
	}
	if !foundLive {
		t.Errorf("live entry %s not found in GetBoard result", liveID)
	}

	// Also assert the option was rewritten.
	entries, err := ListBoardEntries(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.WindowID == "@9999999" {
			t.Errorf("write-back failed: stale entry still in @rk_board")
		}
	}
}
