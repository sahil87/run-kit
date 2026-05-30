package sessions

import (
	"testing"

	"rk/internal/tmux"
)

// activeWindowID returns the WindowID of the single active window, or "" if
// none (or more than one) is active — also used to assert the single-highlight
// invariant.
func activeWindowID(t *testing.T, windows []tmux.WindowInfo) string {
	t.Helper()
	active := ""
	count := 0
	for _, w := range windows {
		if w.IsActiveWindow {
			active = w.WindowID
			count++
		}
	}
	if count > 1 {
		t.Fatalf("single-highlight invariant violated: %d windows active", count)
	}
	return active
}

func windows(activeID string, ids ...string) []tmux.WindowInfo {
	ws := make([]tmux.WindowInfo, 0, len(ids))
	for i, id := range ids {
		ws = append(ws, tmux.WindowInfo{Index: i, WindowID: id, IsActiveWindow: id == activeID})
	}
	return ws
}

func TestApplyActiveWindow_Tier1WinsOverStaleBase(t *testing.T) {
	// Base pointer (parsed) says @24, but the tracked Tier-1 value is @27.
	ws := windows("@24", "@0", "@24", "@27")
	applyActiveWindow(ws, "@27")

	if got := activeWindowID(t, ws); got != "@27" {
		t.Fatalf("Tier 1 should win: active = %q, want @27", got)
	}
}

func TestApplyActiveWindow_Tier2FallbackWhenNoTracked(t *testing.T) {
	// Empty trackedWid → keep base-pointer flag untouched (@24).
	ws := windows("@24", "@0", "@24", "@27")
	applyActiveWindow(ws, "")

	if got := activeWindowID(t, ws); got != "@24" {
		t.Fatalf("Tier 2 fallback: active = %q, want @24", got)
	}
}

func TestApplyActiveWindow_ExternalClientMoveFollowed(t *testing.T) {
	// Simulates an iTerm activation of @9; the tracker recorded @9 (it emits
	// %session-window-changed too). No base-pointer-override path needed.
	ws := windows("@0", "@0", "@9")
	applyActiveWindow(ws, "@9")

	if got := activeWindowID(t, ws); got != "@9" {
		t.Fatalf("external move: active = %q, want @9", got)
	}
}

func TestApplyActiveWindow_SingleHighlightInvariant(t *testing.T) {
	ws := windows("@0", "@0", "@24", "@27")
	applyActiveWindow(ws, "@27")

	count := 0
	for _, w := range ws {
		if w.IsActiveWindow {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("exactly one window must be active, got %d", count)
	}
	if !ws[2].IsActiveWindow {
		t.Fatalf("@27 (index 2) should be the active one")
	}
}

func TestApplyActiveWindow_StaleTrackedWidFallsBackToTier2(t *testing.T) {
	// Tracked @99 matches no live window (window closed between event and
	// fetch). Must fall back to the base pointer (@24), not mark none.
	ws := windows("@24", "@0", "@24", "@27")
	applyActiveWindow(ws, "@99")

	if got := activeWindowID(t, ws); got != "@24" {
		t.Fatalf("stale tracked wid should fall back to Tier 2: active = %q, want @24", got)
	}
}

// fakeProvider implements ActiveWindowProvider for asserting the seam contract
// (nil-provider degradation is covered by passing nil directly to the consumer).
type fakeProvider struct {
	server string
	group  string
	wid    string
}

func (f fakeProvider) ActiveWindow(server, group string) (string, bool) {
	if server == f.server && group == f.group {
		return f.wid, true
	}
	return "", false
}

func TestActiveWindowProvider_HitAndMiss(t *testing.T) {
	p := fakeProvider{server: "default", group: "runKit", wid: "@27"}

	if wid, ok := p.ActiveWindow("default", "runKit"); !ok || wid != "@27" {
		t.Fatalf("provider hit = (%q,%v), want (@27,true)", wid, ok)
	}
	if _, ok := p.ActiveWindow("default", "other"); ok {
		t.Fatalf("provider should miss for an untracked group")
	}
	if _, ok := p.ActiveWindow("otherServer", "runKit"); ok {
		t.Fatalf("provider should miss for a different server")
	}
}
