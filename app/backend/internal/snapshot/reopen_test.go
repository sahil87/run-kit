package snapshot

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"rk/internal/tmux"
)

// reopenFixture is a one-record fixture: a two-pane window with a stored active
// pane at position 1, a layout string, and a couple of rk options.
func reopenFixture() ClosedWindow {
	return ClosedWindow{
		ID:       "1",
		ClosedAt: time.Now().UTC(),
		Server:   "kit",
		Session:  "alpha",
		Window: Window{
			Index: 3, ID: "@10", Name: "serve", Layout: "l1", Color: "2", Marker: "solid",
			Panes: []Pane{
				{ID: "%0", Index: 0, Cwd: "/proj", Command: "zsh"},
				{ID: "%1", Index: 1, Cwd: "/proj/sub", Command: "claude", Active: true},
			},
		},
	}
}

func reopenOps() *fakeRestore {
	return &fakeRestore{live: []tmux.SessionInfo{{Name: "alpha"}}}
}

// TestReopenIndexHit: the session exists and the stored index is free — the
// window is created at the stored index/name/cwd, panes and layout are
// recreated, the stored active pane is re-selected, the option re-stamp
// receives exactly WindowOptionOps(rec.Window), and the new window is selected.
func TestReopenIndexHit(t *testing.T) {
	f := reopenOps()
	rec := reopenFixture()

	windowID, err := reopenWindow(context.Background(), "kit", rec, f.ops())
	if err != nil {
		t.Fatalf("reopen: %v\ntrace:\n%s", err, f.trace())
	}
	if windowID != "@1" {
		t.Errorf("windowID = %q, want @1", windowID)
	}

	wantCalls := []string{
		`new-window alpha:3 -n serve -c "/proj" -> @1`,
		`split-window @1 -c "/proj/sub"`,
		`select-layout @1 l1`,
		`select-pane %9`, // stored active pane %1 (position 1) → split-created %9
		`window-opts @1 @rk_win_color=2,@rk_win_marker=solid`,
		`select-window alpha:@1`,
	}
	if got := f.trace(); got != strings.Join(wantCalls, "\n") {
		t.Errorf("call trace mismatch:\ngot:\n%s\n\nwant:\n%s", got, strings.Join(wantCalls, "\n"))
	}
}

// TestReopenOccupiedIndexAppends: an occupied stored index falls back to
// appending after the current window — never a renumber of live neighbours.
func TestReopenOccupiedIndexAppends(t *testing.T) {
	f := reopenOps()
	f.failCreateAt = map[int]error{3: errors.New("index in use")}
	rec := reopenFixture()
	rec.Window.Panes = rec.Window.Panes[:1] // single-pane: keeps the trace focused on the fallback

	windowID, err := reopenWindow(context.Background(), "kit", rec, f.ops())
	if err != nil {
		t.Fatalf("reopen: %v\ntrace:\n%s", err, f.trace())
	}
	if !strings.Contains(f.trace(), `new-window-append alpha -n serve -c "/proj" -> @1`) {
		t.Errorf("append fallback not taken:\n%s", f.trace())
	}
	if windowID != "@1" {
		t.Errorf("windowID = %q, want the append-created @1", windowID)
	}
	if strings.Contains(f.trace(), "renumber-window") {
		t.Errorf("reopen must never renumber a live session:\n%s", f.trace())
	}
	// The rest of the pipeline still runs on the appended window.
	if !strings.Contains(f.trace(), "select-window alpha:@1") {
		t.Errorf("appended window not selected:\n%s", f.trace())
	}
}

// TestReopenCreateFailsOutright: when even the append fallback fails there is
// nothing to hang the rest on — fatal, and nothing but the creates ran.
func TestReopenCreateFailsOutright(t *testing.T) {
	f := reopenOps()
	f.failCreateAt = map[int]error{3: errors.New("index in use")}
	f.opsCreateAppendErr = errors.New("boom")
	rec := reopenFixture()

	if _, err := reopenWindow(context.Background(), "kit", rec, f.ops()); err == nil {
		t.Fatal("want error when both create paths fail")
	}
	if strings.Contains(f.trace(), "split-window") || strings.Contains(f.trace(), "window-opts") {
		t.Errorf("post-create steps ran without a window:\n%s", f.trace())
	}
}

// TestReopenDeadCwdDegrades: a stored cwd whose directory is gone degrades to
// "" (the server default dir) on the create AND the per-pane splits — a dead
// cwd never fails the reopen.
func TestReopenDeadCwdDegrades(t *testing.T) {
	f := reopenOps()
	f.missingDirs = map[string]bool{"/proj": true, "/proj/sub": true}

	if _, err := reopenWindow(context.Background(), "kit", reopenFixture(), f.ops()); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if !strings.Contains(f.trace(), `new-window alpha:3 -n serve -c "" -> @1`) {
		t.Errorf("missing cwd not dropped from create:\n%s", f.trace())
	}
	if !strings.Contains(f.trace(), `split-window @1 -c ""`) {
		t.Errorf("missing cwd not dropped from split:\n%s", f.trace())
	}
}

// TestReopenSessionGone: a record whose session no longer exists refuses with
// the typed SessionGoneError (the route maps it to 409 and drops the record)
// and touches nothing.
func TestReopenSessionGone(t *testing.T) {
	f := &fakeRestore{live: []tmux.SessionInfo{{Name: "other"}}}

	_, err := reopenWindow(context.Background(), "kit", reopenFixture(), f.ops())
	if err == nil {
		t.Fatal("want refusal for a gone session")
	}
	var sg *SessionGoneError
	if !errors.As(err, &sg) {
		t.Fatalf("error = %v (%T), want SessionGoneError", err, err)
	}
	if sg.Session != "alpha" {
		t.Errorf("SessionGoneError.Session = %q, want alpha", sg.Session)
	}
	if !strings.Contains(err.Error(), `"alpha"`) {
		t.Errorf("error must name the session: %v", err)
	}
	if len(f.calls) != 0 {
		t.Errorf("session-gone refusal must touch nothing, got calls: %v", f.calls)
	}
}

// TestReopenSessionProbeError: a failed session probe is an infrastructure
// error, NOT session-gone (a transient tmux fault must not drop the record via
// the 409 path).
func TestReopenSessionProbeError(t *testing.T) {
	f := &fakeRestore{}
	ops := f.ops()
	probeErr := errors.New("tmux: connection refused")
	ops.listSessions = func(ctx context.Context, server string) ([]tmux.SessionInfo, error) {
		return nil, probeErr
	}

	_, err := reopenWindow(context.Background(), "kit", reopenFixture(), ops)
	if err == nil {
		t.Fatal("want error for a failed session probe")
	}
	var sg *SessionGoneError
	if errors.As(err, &sg) {
		t.Errorf("probe failure misclassified as session-gone: %v", err)
	}
}

// TestReopenPerStepFailuresDegrade: option re-stamp, layout, split, and
// select-window failures never fail the reopen — the window exists and the id
// is returned.
func TestReopenPerStepFailuresDegrade(t *testing.T) {
	f := reopenOps()
	f.failSplit = errors.New("boom")
	f.failLayout = errors.New("boom")
	ops := f.ops()
	ops.setWindowOpts = func(ctx context.Context, windowID, server string, o []tmux.WindowOptionOp) error {
		f.calls = append(f.calls, "window-opts (failed)")
		return errors.New("boom")
	}
	ops.selectWindow = func(session, windowID, server string) error {
		f.calls = append(f.calls, "select-window (failed)")
		return errors.New("boom")
	}

	windowID, err := reopenWindow(context.Background(), "kit", reopenFixture(), ops)
	if err != nil {
		t.Fatalf("per-step failures must degrade, got: %v", err)
	}
	if windowID != "@1" {
		t.Errorf("windowID = %q, want @1", windowID)
	}
	// A failed split means pane 1 has no id: no active-pane re-select.
	if strings.Contains(f.trace(), "select-pane") {
		t.Errorf("active pane selected despite failed split:\n%s", f.trace())
	}
}

// TestReopenWindowOptionOpsSetEquality: the re-stamp set equals
// WindowOptionOps(rec.Window) exactly — the single shared mapping, no second
// option list.
func TestReopenWindowOptionOpsSetEquality(t *testing.T) {
	f := reopenOps()
	rec := reopenFixture()
	rec.Window.RkLayout = "split-h:tty,web"
	rec.Window.WebTabs = []string{"/proxy/1/", "https://x/"}
	rec.Window.WebRoots = []string{"/r1", ""}
	rec.Window.WebActive = 2
	rec.Window.CodeRoot = "/w"

	var got []tmux.WindowOptionOp
	ops := f.ops()
	origSet := ops.setWindowOpts
	ops.setWindowOpts = func(ctx context.Context, windowID, server string, o []tmux.WindowOptionOp) error {
		got = o
		return origSet(ctx, windowID, server, o)
	}

	if _, err := reopenWindow(context.Background(), "kit", rec, ops); err != nil {
		t.Fatal(err)
	}
	want := WindowOptionOps(rec.Window)
	if len(got) != len(want) {
		t.Fatalf("ops len = %d, want %d (%v)", len(got), len(want), want)
	}
	for i := range want {
		if got[i].Key != want[i].Key ||
			(got[i].Value == nil) != (want[i].Value == nil) ||
			(got[i].Value != nil && *got[i].Value != *want[i].Value) {
			t.Errorf("op %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
