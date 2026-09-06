package cron

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"rk/internal/tmux"
)

// fakeDeliverer records every delivered fire.
type fakeDeliverer struct {
	fires []Fire
}

func (f *fakeDeliverer) Deliver(ctx context.Context, fire Fire) Outcome {
	f.fires = append(f.fires, fire)
	return Outcome{Status: "delivered"}
}

// writeEntryFile writes an entries file for slug into dir.
func writeEntryFile(t *testing.T, dir, slug, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, slug+".yaml"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

const tickEntryYAML = `
entries:
  - id: a3f9
    name: hourly sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%%42" }
    payload: "sweep"
    deliver: immediate
    if_absent: skip
    created_by: { session: 4fe2, pane: "%%42", at: %d }
`

// TestTickDeadServerUntouched is the A-016 pin: entry files exist for live1
// and dead1, only live1 enumerates, and the tick issues ZERO tmux commands for
// dead1 — the seam fake fails the test if any call targets it.
func TestTickDeadServerUntouched(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", sprintfTick(T))
	writeEntryFile(t, dir, "dead1", sprintfTick(T))

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: del,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if fk.callsFor("dead1") != 0 {
		t.Fatalf("tmux calls targeted dead1: %v — a dead socket must never be touched", fk.calls)
	}
	if fk.callsFor("live1") == 0 {
		t.Error("no tmux calls for live1 — facts were never gathered")
	}
	if !hasDiag(res.Diags, "server-not-live") {
		t.Errorf("diags = %v, want a server-not-live diagnostic for dead1", diagReasons(res.Diags))
	}
	if res.Fires != 1 {
		t.Fatalf("fires = %d, want 1 (live1's overdue every entry)", res.Fires)
	}
}

func sprintfTick(T time.Time) string {
	return fmt.Sprintf(tickEntryYAML, T.Add(-2*time.Hour).Unix())
}

// TestTickDeliverLogCursor: one due entry delivers through the seam exactly
// once, the log gains exactly one line with the outcome, and the cursor file
// is written (R15).
func TestTickDeliverLogCursor(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", sprintfTick(T))

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: del,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Fires != 1 {
		t.Fatalf("fires = %d, want 1", res.Fires)
	}
	if len(del.fires) != 1 {
		t.Fatalf("deliverer got %d fires, want exactly 1", len(del.fires))
	}
	fire := del.fires[0]
	if fire.Entry.ID != "a3f9" || fire.PaneID != "%42" || fire.Reason != FireSchedule || fire.Server != "live1" {
		t.Errorf("fire = %+v", fire)
	}

	// Exactly one log line with the fake's outcome.
	lines := ReadLog(filepath.Join(dir, "live1.log"))
	if len(lines) != 1 {
		t.Fatalf("log lines = %d, want 1", len(lines))
	}
	line := lines[0]
	if line.Entry != "a3f9" || line.Target != "%42" || line.Reason != "schedule" ||
		line.Outcome != "delivered" || line.TS != T.Unix() {
		t.Errorf("log line = %+v", line)
	}

	// The wake cursor was persisted (no wake entries ⇒ empty-but-valid file).
	cursorPath := filepath.Join(dir, "live1.cursor.yaml")
	if _, err := os.Stat(cursorPath); err != nil {
		t.Errorf("cursor not written: %v", err)
	}
}

// TestTickLockContention is the A-017 pin: with the lock held, a tick returns
// immediately — no fires, no log writes, no cursor writes, no error.
func TestTickLockContention(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", sprintfTick(T))

	release, err := acquireLock(LockPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			t.Error("ListServers called under contention — the lock must gate everything")
			return []string{"live1"}, nil
		},
		Tmux:      newFakeTmux(),
		Deliverer: del,
	})
	if err != nil {
		t.Fatalf("contended tick returned error: %v", err)
	}
	if res.Fires != 0 || len(res.Diags) != 0 || len(del.fires) != 0 {
		t.Errorf("contended tick: fires=%d diags=%v delivered=%d, want all zero", res.Fires, res.Diags, len(del.fires))
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "live1.yaml" && e.Name() != ".lock" {
			t.Errorf("contended tick wrote %s", e.Name())
		}
	}
}

// TestTickCorruptEntryFileNeverAborts: a corrupt entry file for a live server
// is a diagnostic, and the tick continues (A-019).
func TestTickCorruptEntryFileNeverAborts(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", "{{{{ not yaml")

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: &fakeDeliverer{},
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatalf("tick aborted on a corrupt entry file: %v", err)
	}
	if !hasDiag(res.Diags, "entry-file-corrupt") {
		t.Errorf("diags = %v, want entry-file-corrupt", diagReasons(res.Diags))
	}
	if res.Fires != 0 {
		t.Errorf("fires = %d, want 0", res.Fires)
	}
}

// TestTickSuppressWhileEndToEnd: a due entry whose guard holds is not
// delivered and not logged (suppression precedes emission, A-009).
func TestTickSuppressWhileEndToEnd(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", `
entries:
  - id: a3f9
    schedule: { kind: every, interval: 1h }
    suppress_while: [nothing-tracked]
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
    created_by: { session: s, pane: "%42", at: 1 }
`)
	// The fab operator state file: nothing tracked ⇒ the guard holds.
	opDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(opDir, "live1.yaml"), []byte("monitored: []\nwatches: []\nautopilot: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: del,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(opDir, slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Fires != 0 || len(del.fires) != 0 {
		t.Errorf("suppressed entry delivered: fires=%d delivered=%d", res.Fires, len(del.fires))
	}
	if !hasDiag(res.Diags, "suppressed") {
		t.Errorf("diags = %v, want suppressed", diagReasons(res.Diags))
	}
	if lines := ReadLog(filepath.Join(dir, "live1.log")); len(lines) != 0 {
		t.Errorf("log lines = %d, want 0 — a suppression is never a recorded miss", len(lines))
	}
}
