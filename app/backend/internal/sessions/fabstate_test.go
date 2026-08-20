package sessions

import (
	"os"
	"path/filepath"
	"testing"

	"rk/internal/tmux"
)

// mkFabWorktree builds a worktree fixture: fab/changes/<name>/.status.yaml
// carrying the given progress body, linked from the worktree root's
// .fab-status.yaml symlink (relative target, as fab writes it). Returns the
// worktree root.
func mkFabWorktree(t *testing.T, change, statusBody string) string {
	t.Helper()
	root := t.TempDir()
	changeDir := filepath.Join(root, "fab", "changes", change)
	if err := os.MkdirAll(changeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(changeDir, ".status.yaml"), []byte(statusBody), 0o644); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join("fab", "changes", change, ".status.yaml")
	if err := os.Symlink(target, filepath.Join(root, fabStatusLinkName)); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestFabStateWalkUpAndChangeName(t *testing.T) {
	root := mkFabWorktree(t, "260820-hol4-mux-panes", "progress:\n    intake: done\n    apply: active\n    review: pending\n")

	// A pane cwd in a subdirectory still resolves via the walk-up.
	sub := filepath.Join(root, "app", "backend")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	st := newFabStateMemo().derive(sub)
	if st.change != "260820-hol4-mux-panes" {
		t.Errorf("change = %q, want the symlink target's parent dir basename", st.change)
	}
	if st.stage != "apply" || st.displayState != "active" {
		t.Errorf("stage/state = %q/%q, want apply/active", st.stage, st.displayState)
	}
}

func TestFabDisplayStageTiers(t *testing.T) {
	cases := []struct {
		name      string
		progress  string
		wantStage string
		wantState string
	}{
		{"tier 1: first active wins", "intake: done\n    apply: failed\n    review: active\n    hydrate: ready", "review", "active"},
		{"tier 2: first failed outranks ready", "intake: done\n    review: failed\n    hydrate: ready", "review", "failed"},
		{"tier 3: first ready", "intake: done\n    apply: done\n    review: ready", "review", "ready"},
		{"tier 4: last done or skipped", "intake: done\n    apply: done\n    review: skipped\n    hydrate: pending", "review", "skipped"},
		{"tier 5: all pending falls back to the first stage", "intake: pending\n    apply: pending", "intake", "pending"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := mkFabWorktree(t, "c", "progress:\n    "+tc.progress+"\n")
			st := newFabStateMemo().derive(root)
			if st.stage != tc.wantStage || st.displayState != tc.wantState {
				t.Errorf("got (%q, %q), want (%q, %q)", st.stage, st.displayState, tc.wantStage, tc.wantState)
			}
		})
	}
}

func TestFabStateDegradesFailOpen(t *testing.T) {
	t.Run("no symlink ancestor", func(t *testing.T) {
		st := newFabStateMemo().derive(t.TempDir())
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
	})

	t.Run("dangling symlink (archived change)", func(t *testing.T) {
		root := t.TempDir()
		target := filepath.Join("fab", "changes", "gone", ".status.yaml")
		if err := os.Symlink(target, filepath.Join(root, fabStatusLinkName)); err != nil {
			t.Fatal(err)
		}
		st := newFabStateMemo().derive(root)
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
	})

	t.Run("corrupt YAML", func(t *testing.T) {
		root := mkFabWorktree(t, "c", "progress: [unclosed\n")
		st := newFabStateMemo().derive(root)
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
	})

	t.Run("empty progress map", func(t *testing.T) {
		root := mkFabWorktree(t, "c", "id: x\nprogress:\n")
		st := newFabStateMemo().derive(root)
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
	})

	t.Run("progress not a mapping", func(t *testing.T) {
		root := mkFabWorktree(t, "c", "progress: just-a-string\n")
		st := newFabStateMemo().derive(root)
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
	})

	t.Run("missing cwd is skipped", func(t *testing.T) {
		st := newFabStateMemo().derive("")
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
		// A cwd that no longer exists on disk walks up finding nothing.
		gone := filepath.Join(t.TempDir(), "deleted-worktree")
		st = newFabStateMemo().derive(gone)
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
	})
}

func TestFabStateMemoDedupesWithinACall(t *testing.T) {
	root := mkFabWorktree(t, "c", "progress:\n    apply: active\n")
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	m := newFabStateMemo()
	first := m.derive(sub)
	// Break the fixture: a fresh read would now fail. A memoized second derive
	// must still return the first result, proving one read per call.
	if err := os.Remove(filepath.Join(root, fabStatusLinkName)); err != nil {
		t.Fatal(err)
	}
	second := m.derive(sub)
	if first != second || second.change != "c" {
		t.Errorf("first = %+v, second = %+v, want the memoized first result", first, second)
	}
	// A NEW memo (the next FetchSessions call) sees the filesystem as it is —
	// nothing persists across calls.
	if st := newFabStateMemo().derive(sub); st != (fabState{}) {
		t.Errorf("fresh memo got %+v, want zero value after the link is gone", st)
	}
}

// TestFabWindowRollup covers the window-level selection semantics over the
// native derivation: a change-bound pane wins regardless of pane order, the
// first pane with a derivation wins among change-bound peers, and a window of
// unresolvable panes degrades to empty fields.
func TestFabWindowRollup(t *testing.T) {
	bound := mkFabWorktree(t, "change-x", "progress:\n    review: failed\n    hydrate: ready\n")
	boundOther := mkFabWorktree(t, "change-y", "progress:\n    apply: active\n")
	plain := t.TempDir()

	t.Run("change-bound pane beats a plain pane regardless of order", func(t *testing.T) {
		for _, panes := range [][]tmux.PaneInfo{
			{{Cwd: plain}, {Cwd: bound}},
			{{Cwd: bound}, {Cwd: plain}},
		} {
			st := newFabStateMemo().windowState(panes)
			if st.change != "change-x" || st.stage != "review" || st.displayState != "failed" {
				t.Errorf("panes %+v: got %+v, want change-x review/failed", panes, st)
			}
		}
	})

	t.Run("first change-bound pane in pane order wins", func(t *testing.T) {
		st := newFabStateMemo().windowState([]tmux.PaneInfo{{Cwd: boundOther}, {Cwd: bound}})
		if st.change != "change-y" {
			t.Errorf("change = %q, want change-y (first in pane order)", st.change)
		}
	})

	t.Run("no derivable pane yields empty fields", func(t *testing.T) {
		st := newFabStateMemo().windowState([]tmux.PaneInfo{{Cwd: plain}, {Cwd: ""}})
		if st != (fabState{}) {
			t.Errorf("got %+v, want zero value", st)
		}
	})
}
