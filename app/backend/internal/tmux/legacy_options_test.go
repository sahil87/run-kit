package tmux

import (
	"context"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

// legacyTmuxDo runs a tmux command against the isolated test server, failing
// the test on error.
func legacyTmuxDo(t *testing.T, server string, args ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	full := append([]string{"-L", server}, args...)
	if out, err := exec.CommandContext(ctx, "tmux", full...).CombinedOutput(); err != nil {
		t.Fatalf("tmux %v: %v\n%s", args, err, string(out))
	}
}

// legacyHeld reads a user option at an exact scope via show-options -qv,
// returning ("", false) when unset (show -qv exits 0 with empty output for an
// unset option). showArgs select the scope, e.g. "-w", "-t", "@1", "@color".
func legacyHeld(t *testing.T, server string, showArgs ...string) (string, bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	full := append([]string{"-L", server, "show-options", "-qv"}, showArgs...)
	out, err := exec.CommandContext(ctx, "tmux", full...).CombinedOutput()
	if err != nil {
		return "", false
	}
	v := strings.TrimSpace(string(out))
	return v, v != ""
}

func TestMigrateLegacyOptions_rightScopeWindowMove(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")
	legacyTmuxDo(t, server, "set-option", "-w", "-t", id, "@color", "5")

	if err := MigrateLegacyOptions(context.Background(), server); err != nil {
		t.Fatalf("MigrateLegacyOptions: %v", err)
	}

	if v, ok := legacyHeld(t, server, "-w", "-t", id, ColorOption); !ok || v != "5" {
		t.Errorf("%s = %q (held=%v), want \"5\"", ColorOption, v, ok)
	}
	if v, ok := legacyHeld(t, server, "-w", "-t", id, "@color"); ok {
		t.Errorf("@color still held at window scope: %q", v)
	}
}

func TestMigrateLegacyOptions_rightScopeSessionMove(t *testing.T) {
	server := withSessionOrderTmux(t)
	legacyTmuxDo(t, server, "set-option", "-t", "=boot:", "@session_color", "4")

	if err := MigrateLegacyOptions(context.Background(), server); err != nil {
		t.Fatalf("MigrateLegacyOptions: %v", err)
	}

	if v, ok := legacyHeld(t, server, "-t", "=boot:", SessionColorOption); !ok || v != "4" {
		t.Errorf("%s = %q (held=%v), want \"4\"", SessionColorOption, v, ok)
	}
	if v, ok := legacyHeld(t, server, "-t", "=boot:", "@session_color"); ok {
		t.Errorf("@session_color still held at session scope: %q", v)
	}
}

// The fabKit case: a session-scoped @color must be purged, never copied
// forward to the window scope.
func TestMigrateLegacyOptions_sessionScopeColorPurgedNoCopy(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")
	legacyTmuxDo(t, server, "set-option", "-t", "=boot:", "@color", "slate")

	if err := MigrateLegacyOptions(context.Background(), server); err != nil {
		t.Fatalf("MigrateLegacyOptions: %v", err)
	}

	if v, ok := legacyHeld(t, server, "-t", "=boot:", "@color"); ok {
		t.Errorf("@color still held at session scope: %q", v)
	}
	if v, ok := legacyHeld(t, server, "-w", "-t", id, ColorOption); ok {
		t.Errorf("window gained %s from a wrong-scope value: %q", ColorOption, v)
	}
}

func TestMigrateLegacyOptions_globalColorPurged(t *testing.T) {
	server := withSessionOrderTmux(t)
	legacyTmuxDo(t, server, "set-option", "-g", "@color", "3")

	if err := MigrateLegacyOptions(context.Background(), server); err != nil {
		t.Fatalf("MigrateLegacyOptions: %v", err)
	}

	if v, ok := legacyHeld(t, server, "-g", "@color"); ok {
		t.Errorf("@color still held at global scope: %q", v)
	}
}

func TestMigrateLegacyOptions_newAlreadySetKeepsNew(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")
	legacyTmuxDo(t, server, "set-option", "-w", "-t", id, "@color", "5")
	legacyTmuxDo(t, server, "set-option", "-w", "-t", id, ColorOption, "7")

	if err := MigrateLegacyOptions(context.Background(), server); err != nil {
		t.Fatalf("MigrateLegacyOptions: %v", err)
	}

	if v, ok := legacyHeld(t, server, "-w", "-t", id, ColorOption); !ok || v != "7" {
		t.Errorf("%s = %q (held=%v), want \"7\" (pre-existing value untouched)", ColorOption, v, ok)
	}
	if v, ok := legacyHeld(t, server, "-w", "-t", id, "@color"); ok {
		t.Errorf("@color still held at window scope: %q", v)
	}
}

func TestMigrateLegacyOptions_idempotent(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")
	legacyTmuxDo(t, server, "set-option", "-w", "-t", id, "@color", "5")
	legacyTmuxDo(t, server, "set-option", "-t", "=boot:", "@session_color", "4")

	changed, err := sweepLegacyOptions(context.Background(), server)
	if err != nil {
		t.Fatalf("first sweep: %v", err)
	}
	if !changed {
		t.Error("first sweep reported changed=false, want true")
	}

	changed, err = sweepLegacyOptions(context.Background(), server)
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if changed {
		t.Error("second sweep reported changed=true, want false (zero set-option calls)")
	}
}

// A failing carrier logs and the remaining carriers are still processed; the
// first error is returned.
func TestMigrateLegacyOptions_carrierFailureIsolates(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")
	legacyTmuxDo(t, server, "set-option", "-w", "-t", id, "@color", "5")

	targets, err := enumerateScopeTargets(context.Background(), server)
	if err != nil {
		t.Fatalf("enumerate: %v", err)
	}
	// A window that no longer exists fails its show-options read.
	bogus := scopeTarget{scope: scopeWindow, target: "@99999"}
	targets = append([]scopeTarget{bogus}, targets...)

	changed, err := sweepLegacyTargets(context.Background(), server, targets)
	if err == nil {
		t.Fatal("sweep with a dead carrier returned nil error, want the first error")
	}
	if !changed {
		t.Error("sweep reported changed=false — the live carrier was not processed after the failure")
	}
	if v, ok := legacyHeld(t, server, "-w", "-t", id, ColorOption); !ok || v != "5" {
		t.Errorf("%s = %q (held=%v), want \"5\" — failure must not skip live carriers", ColorOption, v, ok)
	}
}

func TestMigrateLegacyOptions_deadServerErrors(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	if err := MigrateLegacyOptions(context.Background(), "rk-test-legacy-dead"); err == nil {
		t.Error("MigrateLegacyOptions on a dead server returned nil error")
	}
}

func TestMigrateLegacyOptionsOnce_runsBodyExactlyOnce(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")
	legacyTmuxDo(t, server, "set-option", "-w", "-t", id, "@color", "5")

	ResetLegacyMigrationForTest()
	t.Cleanup(ResetLegacyMigrationForTest)

	const callers = 8
	var wg sync.WaitGroup
	changedVotes := make(chan bool, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			changed, err := MigrateLegacyOptionsOnce(context.Background(), server)
			if err != nil {
				t.Errorf("Once: %v", err)
			}
			changedVotes <- changed
		}()
	}
	wg.Wait()
	close(changedVotes)

	changedCount := 0
	for c := range changedVotes {
		if c {
			changedCount++
		}
	}
	if changedCount != 1 {
		t.Errorf("changed=true from %d callers, want exactly 1 (body runs once)", changedCount)
	}
	if v, ok := legacyHeld(t, server, "-w", "-t", id, ColorOption); !ok || v != "5" {
		t.Errorf("%s = %q (held=%v), want \"5\"", ColorOption, v, ok)
	}
}

// The guard marks on ATTEMPT: a server whose sweep failed is not retried on
// the next Once call.
func TestMigrateLegacyOptionsOnce_marksOnAttempt(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	ResetLegacyMigrationForTest()
	t.Cleanup(ResetLegacyMigrationForTest)

	const dead = "rk-test-legacy-dead"
	if _, err := MigrateLegacyOptionsOnce(context.Background(), dead); err == nil {
		t.Fatal("first Once on a dead server returned nil error")
	}
	changed, err := MigrateLegacyOptionsOnce(context.Background(), dead)
	if err != nil {
		t.Errorf("second Once re-ran the sweep (err=%v) — guard must mark on attempt", err)
	}
	if changed {
		t.Error("second Once reported changed=true, want false")
	}
}

func TestCountLegacyOptions(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")

	n, err := CountLegacyOptions(context.Background(), server)
	if err != nil {
		t.Fatalf("CountLegacyOptions: %v", err)
	}
	if n != 0 {
		t.Errorf("clean server count = %d, want 0", n)
	}

	legacyTmuxDo(t, server, "set-option", "-w", "-t", id, "@color", "5")
	legacyTmuxDo(t, server, "set-option", "-t", "=boot:", "@color", "slate")
	legacyTmuxDo(t, server, "set-option", "-g", "@session_color", "2")

	n, err = CountLegacyOptions(context.Background(), server)
	if err != nil {
		t.Fatalf("CountLegacyOptions: %v", err)
	}
	if n != 3 {
		t.Errorf("seeded count = %d, want 3 (window @color, session @color, global @session_color)", n)
	}

	if err := MigrateLegacyOptions(context.Background(), server); err != nil {
		t.Fatalf("MigrateLegacyOptions: %v", err)
	}
	n, err = CountLegacyOptions(context.Background(), server)
	if err != nil {
		t.Fatalf("CountLegacyOptions after sweep: %v", err)
	}
	if n != 0 {
		t.Errorf("post-sweep count = %d, want 0", n)
	}
}

// TestMarkThenReportSweep_composes pins the production wiring of the two
// async hook seams (pre-attach reload, reload-config handler): the caller
// takes the once-guard synchronously via MarkLegacyMigrationAttempt, then
// runs the NON-re-marking MigrateLegacyOptionsReport off its goroutine. A
// re-marking entry would see the guard already burned and return without
// sweeping — the cycle-1 regression this test exists to catch.
func TestMarkThenReportSweep_composes(t *testing.T) {
	server := withSessionOrderTmux(t)
	legacyTmuxDo(t, server, "set-option", "-t", "=boot:", "@color", "slate")
	ResetLegacyMigrationForTest()
	t.Cleanup(ResetLegacyMigrationForTest)

	// First caller wins the mark; the report entry must still sweep (it does
	// not re-mark).
	if !MarkLegacyMigrationAttempt(server) {
		t.Fatal("first MarkLegacyMigrationAttempt = false, want the first caller to win the mark")
	}
	changed, err := MigrateLegacyOptionsReport(context.Background(), server)
	if err != nil {
		t.Fatalf("MigrateLegacyOptionsReport: %v", err)
	}
	if !changed {
		t.Error("MigrateLegacyOptionsReport changed = false after a taken mark — the sweep must still run (non-re-marking entry)")
	}
	if v, ok := legacyHeld(t, server, "-t", "=boot:", "@color"); ok {
		t.Errorf("session @color = %q after the sweep, want purged", v)
	}

	// A second caller loses the mark and sweeps nothing.
	if MarkLegacyMigrationAttempt(server) {
		t.Error("second MarkLegacyMigrationAttempt = true, want false — the guard is burned on attempt")
	}
}

// legacySeed is one seeded legacy option: the retired name, its scope-named
// successor ("" for the unset-only @rk_ctl_keepalive row), the value, and the
// show-options args selecting the scope it is legitimate at.
type legacySeed struct {
	old, new, val string
	showArgs      []string
}

// TestMigrateLegacyOptions_scopePrefixRename seeds ALL 16 scope-prefix legacy
// names at their correct scopes on a real test socket (7 window options on
// the boot window, 5 session options incl. the retired @rk_ctl_keepalive, 4
// server options via set-option -s) and asserts the sweep moves each onto its
// scope-named successor at the same scope, deletes the keepalive, and leaves
// no legacy name behind. A second sweep issues zero set/unset calls, and a
// legacy name at a WRONG scope is purged with no copy-forward.
func TestMigrateLegacyOptions_scopePrefixRename(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")

	windowSeeds := []legacySeed{
		{legacyTypeOption, LensOption, "iframe", []string{"-w", "-t", id}},
		{legacyURLOption, URLOption, "https://example.test/app", []string{"-w", "-t", id}},
		{"@rk_present_root", PresentRootOption, "/srv/root", []string{"-w", "-t", id}},
		{"@rk_marker", MarkerOption, "solid", []string{"-w", "-t", id}},
		{"@rk_flair", FlairOption, "nyan", []string{"-w", "-t", id}},
		// Spaced value: the copy must carry the raw text, not the quoted
		// enumeration form (`"1756036800:old note"`) tmux prints without -v.
		{legacyNoteOption, NoteOption, "1756036800:old note", []string{"-w", "-t", id}},
		{"@rk_role", RoleOption, "operator", []string{"-w", "-t", id}},
	}
	sessionSeeds := []legacySeed{
		{"@rk_session_flair", SessionFlairOption, "naruto", []string{"-t", "=boot:"}},
		{"@rk_board", BoardOption, "main", []string{"-t", "=boot:"}},
		{"@rk_home", HomeOption, "boot", []string{"-t", "=boot:"}},
		{"@rk_board_order", BoardOrderOption, "main,deploy", []string{"-t", "=boot:"}},
		// Retired with no successor: unset-only row.
		{"@rk_ctl_keepalive", "", "1", []string{"-t", "=boot:"}},
	}
	serverSeeds := []legacySeed{
		{"@rk_session_order", SessionOrderOption, `["boot","extra"]`, []string{"-s"}},
		{"@rk_server_rank", ServerRankOption, "7", []string{"-s"}},
		{"@rk_origin", OriginOption, "http://127.0.0.1:3001", []string{"-s"}},
		{"@rk_managed", ManagedOption, "1", []string{"-s"}},
	}

	for _, s := range windowSeeds {
		legacyTmuxDo(t, server, "set-option", "-w", "-t", id, s.old, s.val)
	}
	for _, s := range sessionSeeds {
		legacyTmuxDo(t, server, "set-option", "-t", "=boot:", s.old, s.val)
	}
	for _, s := range serverSeeds {
		legacyTmuxDo(t, server, "set-option", "-s", s.old, s.val)
	}
	// A window option name held on the SERVER table is a wrong-scope hold:
	// the sweep purges it and never copies the value forward.
	legacyTmuxDo(t, server, "set-option", "-s", "@rk_role", "contaminated")

	if err := MigrateLegacyOptions(context.Background(), server); err != nil {
		t.Fatalf("MigrateLegacyOptions: %v", err)
	}

	seeds := append(append(append([]legacySeed{}, windowSeeds...), sessionSeeds...), serverSeeds...)
	for _, s := range seeds {
		if s.new != "" {
			if v, ok := legacyHeld(t, server, append(s.showArgs, s.new)...); !ok || v != s.val {
				t.Errorf("%s = %q (held=%v), want %q at the same scope", s.new, v, ok, s.val)
			}
		}
		if v, ok := legacyHeld(t, server, append(s.showArgs, s.old)...); ok {
			t.Errorf("legacy %s still held after the sweep: %q", s.old, v)
		}
	}

	// Wrong-scope purge: gone from the server table, and the contaminated
	// value never reached the legitimate successor (the window-scope row
	// migrated its own value).
	if v, ok := legacyHeld(t, server, "-s", "@rk_role"); ok {
		t.Errorf("wrong-scope @rk_role still held at server scope: %q", v)
	}
	if v, ok := legacyHeld(t, server, "-w", "-t", id, RoleOption); !ok || v != "operator" {
		t.Errorf("window %s = %q (held=%v), want %q — the wrong-scope value must not copy forward", RoleOption, v, ok, "operator")
	}

	// No legacy name remains at any scope.
	if n, err := CountLegacyOptions(context.Background(), server); err != nil || n != 0 {
		t.Errorf("CountLegacyOptions after the sweep = %d (err=%v), want 0", n, err)
	}

	// Idempotent: a second sweep issues zero set/unset calls.
	changed, err := sweepLegacyOptions(context.Background(), server)
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if changed {
		t.Error("second sweep reported changed=true, want false (zero set-option calls)")
	}
}
