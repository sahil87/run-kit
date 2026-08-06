package snapshot

import (
	"context"
	"errors"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// stubLayoutReads swaps the tmux read seams for the duration of a test.
func stubLayoutReads(t *testing.T,
	sessions []tmux.LayoutSession, sessErr error,
	windows []tmux.LayoutWindow, winErr error,
	panes map[string][]tmux.LayoutPane, paneErr error,
	order []string, rank *int,
) {
	t.Helper()
	origSess, origWin, origPane := listLayoutSessions, listLayoutWindows, listLayoutPanes
	origOrder, origRank := getSessionOrder, getServerRank
	listLayoutSessions = func(ctx context.Context, server string) ([]tmux.LayoutSession, error) {
		return sessions, sessErr
	}
	listLayoutWindows = func(ctx context.Context, server string) ([]tmux.LayoutWindow, error) {
		return windows, winErr
	}
	listLayoutPanes = func(ctx context.Context, server string) (map[string][]tmux.LayoutPane, error) {
		return panes, paneErr
	}
	getSessionOrder = func(ctx context.Context, server string) ([]string, error) {
		return order, nil
	}
	getServerRank = func(ctx context.Context, server string) (*int, error) {
		return rank, nil
	}
	t.Cleanup(func() {
		listLayoutSessions, listLayoutWindows, listLayoutPanes = origSess, origWin, origPane
		getSessionOrder, getServerRank = origOrder, origRank
	})
}

func TestCaptureServerAssemblesSnapshot(t *testing.T) {
	rank := 2
	stubLayoutReads(t,
		[]tmux.LayoutSession{
			{Name: "beta", Created: 200, Color: ""},
			{Name: "alpha", Created: 100, Color: "4"},
		}, nil,
		[]tmux.LayoutWindow{
			{Session: "alpha", WindowID: "@2", Index: 2, Name: "shell", Layout: "l2"},
			{Session: "alpha", WindowID: "@1", Index: 1, Name: "serve", Active: true, Layout: "l1",
				Color: "1", RkType: "web", RkURL: "http://x", Marker: "solid"},
			{Session: "beta", WindowID: "@3", Index: 0, Name: "b", Layout: "l3"},
		}, nil,
		map[string][]tmux.LayoutPane{
			"@1": {
				{WindowID: "@1", PaneID: "%1", Index: 1, Cwd: "/b", Command: "claude"},
				{WindowID: "@1", PaneID: "%0", Index: 0, Cwd: "/a", Command: "zsh", Active: true},
			},
		}, nil,
		[]string{"beta", "alpha"}, &rank,
	)

	snap, err := CaptureServer(context.Background(), "kit")
	if err != nil {
		t.Fatalf("CaptureServer: %v", err)
	}
	if snap.Server != "kit" || snap.TakenAt.IsZero() {
		t.Errorf("server/takenAt not set: %+v", snap)
	}
	if snap.ServerRank == nil || *snap.ServerRank != 2 {
		t.Errorf("serverRank = %v, want 2", snap.ServerRank)
	}
	if len(snap.SessionOrder) != 2 || snap.SessionOrder[0] != "beta" {
		t.Errorf("sessionOrder = %v", snap.SessionOrder)
	}
	// Sessions sorted by creation time: alpha (100) before beta (200).
	if len(snap.Sessions) != 2 || snap.Sessions[0].Name != "alpha" || snap.Sessions[1].Name != "beta" {
		t.Fatalf("sessions = %+v", snap.Sessions)
	}
	alpha := snap.Sessions[0]
	if alpha.CreatedAt != 100 || alpha.Color != "4" {
		t.Errorf("alpha meta = %+v", alpha)
	}
	// Windows sorted by index within the session.
	if len(alpha.Windows) != 2 || alpha.Windows[0].ID != "@1" || alpha.Windows[1].ID != "@2" {
		t.Fatalf("alpha windows = %+v", alpha.Windows)
	}
	w1 := alpha.Windows[0]
	if !w1.Active || w1.Layout != "l1" || w1.Color != "1" || w1.RkType != "web" || w1.RkURL != "http://x" || w1.Marker != "solid" {
		t.Errorf("window @1 = %+v", w1)
	}
	// Panes sorted by index.
	if len(w1.Panes) != 2 || w1.Panes[0].ID != "%0" || w1.Panes[1].ID != "%1" {
		t.Fatalf("window @1 panes = %+v", w1.Panes)
	}
	if w1.Panes[0].Cwd != "/a" || w1.Panes[0].Command != "zsh" || !w1.Panes[0].Active {
		t.Errorf("pane %%0 = %+v", w1.Panes[0])
	}
	if snap.WindowCount() != 3 || snap.SessionCount() != 2 {
		t.Errorf("counts = %d sessions / %d windows", snap.SessionCount(), snap.WindowCount())
	}
}

func TestCaptureServerDeadServerErrorPropagates(t *testing.T) {
	dead := errors.New("layout list-sessions: exit status 1: no server running on /tmp/tmux-1/kit")
	stubLayoutReads(t, nil, dead, nil, nil, nil, nil, nil, nil)

	snap, err := CaptureServer(context.Background(), "kit")
	if err == nil {
		t.Fatal("want error for dead server, got nil")
	}
	if snap != nil {
		t.Fatalf("want nil snapshot on error, got %+v", snap)
	}
	if !strings.Contains(err.Error(), "no server running") {
		t.Errorf("error should carry the dead-server text: %v", err)
	}
	if !tmux.IsServerGone(err) {
		t.Errorf("capture error should stay IsServerGone-classifiable: %v", err)
	}
}
