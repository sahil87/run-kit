package main

// Tests for the rk tab signal setter verbs (mark/note/color/flair/owner) —
// the shared setter in tab_signal.go driven end-to-end through runTabCmd
// against an isolated tmux server (the tab_test.go seams).

import (
	"fmt"
	"strings"
	"testing"

	"rk/internal/tmux"
)

func TestTabSignalMarkSetOffAndWake(t *testing.T) {
	env := withTabTestServer(t)

	// Own-tab set (TMUX_PANE points at the boot window).
	stdout, _, err := runTabCmd(t, "mark", "auto:2")
	if err != nil {
		t.Fatalf("mark set: %v", err)
	}
	if stdout != "auto:2\n" {
		t.Errorf("stdout = %q, want auto:2", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.MarkerOption); got != "auto:2" {
		t.Errorf("@rk_win_marker = %q, want auto:2", got)
	}

	// Addressed set.
	if stdout, _, err = runTabCmd(t, "mark", env.bootID, "blocked:3"); err != nil || stdout != "blocked:3\n" {
		t.Errorf("addressed set: stdout = %q, err = %v", stdout, err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.MarkerOption); got != "blocked:3" {
		t.Errorf("@rk_win_marker = %q, want blocked:3", got)
	}

	// --off clears and prints nothing.
	stdout, _, err = runTabCmd(t, "mark", env.bootID, "--off")
	if err != nil {
		t.Fatalf("mark --off: %v", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on --off", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.MarkerOption); got != "" {
		t.Errorf("@rk_win_marker = %q, want unset", got)
	}

	// --off on an already-unset option is a no-op success (idempotent).
	if _, _, err := runTabCmd(t, "mark", env.bootID, "--off"); err != nil {
		t.Errorf("idempotent --off: %v", err)
	}

	// One wake per successful mutation: two sets + two unsets.
	if len(env.wakes) != 4 {
		t.Errorf("wakes = %v, want exactly 4 (2 sets + 2 unsets)", env.wakes)
	}
	for _, s := range env.wakes {
		if s != env.server {
			t.Errorf("wake server = %q, want %q", s, env.server)
		}
	}
}

func TestTabSignalMarkRetiredFlatTokenRejected(t *testing.T) {
	env := withTabTestServer(t)

	// Retired flat tokens are write-side rejected: NormalizeMarker is read-side
	// compat only, and a writer must not mint legacy values.
	stdout, _, err := runTabCmd(t, "mark", env.bootID, "pipe")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if !strings.Contains(err.Error(), "must be one of:") {
		t.Errorf("err = %v, want the closed-set message", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on failure", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.MarkerOption); got != "" {
		t.Errorf("@rk_win_marker = %q, want untouched", got)
	}
	if len(env.wakes) != 0 {
		t.Errorf("wakes = %v, want none on rejection", env.wakes)
	}
}

func TestTabSignalOffWithValueExitsTwo(t *testing.T) {
	env := withTabTestServer(t)

	if _, _, err := runTabCmd(t, "flair", env.bootID, "nyan", "--off"); err == nil || exitCode(err) != exitUsage {
		t.Fatalf("err = %v (code %d), want exit 2", err, exitCode(err))
	} else if !strings.Contains(err.Error(), "--off takes no value") {
		t.Errorf("err = %v, want the --off message", err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.FlairOption); got != "" {
		t.Errorf("@rk_win_flair = %q, want untouched", got)
	}
	if len(env.wakes) != 0 {
		t.Errorf("wakes = %v, want none on a usage error", env.wakes)
	}
}

func TestTabSignalColorNormalizes(t *testing.T) {
	env := withTabTestServer(t)

	stdout, _, err := runTabCmd(t, "color", env.bootID, " 01 + 3 ")
	if err != nil {
		t.Fatalf("color set: %v", err)
	}
	if stdout != "1+3\n" {
		t.Errorf("stdout = %q, want the normalized blend", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.ColorOption); got != "1+3" {
		t.Errorf("@rk_win_color = %q, want 1+3", got)
	}

	if stdout, _, err = runTabCmd(t, "color", env.bootID, "slate"); err != nil || stdout != "slate\n" {
		t.Errorf("family name: stdout = %q, err = %v", stdout, err)
	}

	if _, _, err := runTabCmd(t, "color", env.bootID, "16"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("color 16: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.ColorOption); got != "slate" {
		t.Errorf("@rk_win_color = %q after a failed set, want slate", got)
	}
}

func TestTabSignalFlairAndOwnerClosedSets(t *testing.T) {
	env := withTabTestServer(t)

	if stdout, _, err := runTabCmd(t, "flair", env.bootID, "nyan"); err != nil || stdout != "nyan\n" {
		t.Errorf("flair set: stdout = %q, err = %v", stdout, err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.FlairOption); got != "nyan" {
		t.Errorf("@rk_win_flair = %q, want nyan", got)
	}
	if _, _, err := runTabCmd(t, "flair", env.bootID, "bogus"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("flair bogus: err = %v (code %d), want exit 2", err, exitCode(err))
	}

	if stdout, _, err := runTabCmd(t, "owner", env.bootID, "operator"); err != nil || stdout != "operator\n" {
		t.Errorf("owner set: stdout = %q, err = %v", stdout, err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.OwnerOption); got != "operator" {
		t.Errorf("@rk_win_owner = %q, want operator", got)
	}
	if _, _, err := runTabCmd(t, "owner", env.bootID, "done"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("owner done: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if _, _, err := runTabCmd(t, "owner", "--off"); err != nil {
		t.Errorf("owner --off (own tab): %v", err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.OwnerOption); got != "" {
		t.Errorf("@rk_win_owner = %q, want unset", got)
	}
	// Two successful sets + one unset wake; the two rejections do not.
	if len(env.wakes) != 3 {
		t.Errorf("wakes = %v, want exactly 3", env.wakes)
	}
}

func TestTabSignalNote(t *testing.T) {
	env := withTabTestServer(t)
	origNow := tabNowFn
	tabNowFn = func() int64 { return 1756036800 }
	t.Cleanup(func() { tabNowFn = origNow })

	// Set stamps the epoch and trims; stdout echoes the stored value.
	stdout, _, err := runTabCmd(t, "note", env.bootID, "  tests green, drafting PR  ")
	if err != nil {
		t.Fatalf("note set: %v", err)
	}
	if stdout != "1756036800:tests green, drafting PR\n" {
		t.Errorf("stdout = %q, want the stamped note", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.NoteOption); got != "1756036800:tests green, drafting PR" {
		t.Errorf("@rk_win_note = %q", got)
	}

	// "-" reads the text from stdin.
	rootCmd.SetIn(strings.NewReader("from stdin"))
	t.Cleanup(func() { rootCmd.SetIn(nil) })
	stdout, _, err = runTabCmd(t, "note", env.bootID, "-")
	if err != nil || stdout != "1756036800:from stdin\n" {
		t.Errorf("note -: stdout = %q, err = %v", stdout, err)
	}

	// Whitespace-only text is a usage error naming --off; nothing written.
	_, _, err = runTabCmd(t, "note", env.bootID, "   ")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("blank note: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if !strings.Contains(err.Error(), "--off") {
		t.Errorf("err = %v, want the --off hint", err)
	}

	// Over-length and control-rune text are rejected before any write.
	if _, _, err := runTabCmd(t, "note", env.bootID, strings.Repeat("x", 121)); err == nil || exitCode(err) != exitUsage {
		t.Errorf("121-char note: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if _, _, err := runTabCmd(t, "note", env.bootID, "a\tb"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("tab in note: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	// Multi-line stdin is rejected the same way (the newline is a control rune).
	rootCmd.SetIn(strings.NewReader("line one\nline two"))
	if _, _, err := runTabCmd(t, "note", env.bootID, "-"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("multi-line stdin: err = %v (code %d), want exit 2", err, exitCode(err))
	}

	if got := tabWindowOption(t, env.server, env.bootID, tmux.NoteOption); got != "1756036800:from stdin" {
		t.Errorf("@rk_win_note = %q after rejections, want untouched", got)
	}

	// --off clears and prints nothing.
	stdout, _, err = runTabCmd(t, "note", "--off")
	if err != nil || stdout != "" {
		t.Errorf("note --off: stdout = %q, err = %v", stdout, err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.NoteOption); got != "" {
		t.Errorf("@rk_win_note = %q, want unset", got)
	}

	// Two successful sets + one unset wake; the four rejections do not.
	if len(env.wakes) != 3 {
		t.Errorf("wakes = %v, want exactly 3", env.wakes)
	}
}

func TestTabSignalSetWithoutValueExitsTwo(t *testing.T) {
	withTabTestServer(t)

	for _, verb := range []string{"mark", "note", "color", "flair", "owner"} {
		if _, _, err := runTabCmd(t, verb); err == nil || exitCode(err) != exitUsage {
			t.Errorf("%s with no value: err = %v (code %d), want exit 2", verb, err, exitCode(err))
		}
	}
	// -L without an explicit address stays usage-class on the new verbs
	// (inherited from resolveTabWindow).
	if _, _, err := runTabCmd(t, "-L", "other", "mark", "auto"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("mark -L with no address: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	// Arg-count violations are usage-class (the usageArgs wrap).
	if _, _, err := runTabCmd(t, "mark", "@1", "auto", "extra"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("mark with three args: err = %v (code %d), want exit 2", err, exitCode(err))
	}
}

func TestTabHelpNamesSignalVerbs(t *testing.T) {
	for _, verb := range []string{"mark", "note", "color", "flair", "owner"} {
		if !strings.Contains(tabCmd.Long, fmt.Sprintf("  %-7s", verb)) {
			t.Errorf("tab Long text omits the %s verb; got:\n%s", verb, tabCmd.Long)
		}
	}
}
