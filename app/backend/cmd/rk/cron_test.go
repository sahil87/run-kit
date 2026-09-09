package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"rk/internal/cron"
)

// resetCronFlags restores every cron-family flag var and Changed bit so one
// Execute() run cannot leak flag state into the next (the resetMuxFlags
// pattern). Also resets the seams the family shares.
func resetCronFlags() {
	cronAddEvery, cronAddBackoff, cronAddCronExpr = 0, false, ""
	cronAddCatchUp = ""
	cronAddMin, cronAddMax = time.Minute, 30*time.Minute
	cronAddName, cronAddDeliver, cronAddIfAbsent = "", cron.DeliverImmediate, cron.IfAbsentSkip
	cronAddRespawn = nil
	cronAddPinned = false
	cronAddRole, cronAddPane, cronAddSession = "", "", ""
	cronListJSONFlag = false
	cronMuteOffFlag, cronMuteForFlag, cronPinOffFlag = false, 0, false
	resetFlagChanged(cronAddCmd, "every", "backoff", "cron", "catch-up", "min", "max", "name", "deliver", "if-absent", "respawn", "pinned", "role", "pane", "session")
	resetFlagChanged(cronListCmd, "json")
	resetFlagChanged(cronMuteCmd, "off", "for")
	resetFlagChanged(cronPinCmd, "off")
	// The parent's persistent -L is shared by every cron invocation, so an
	// explicit `-L x` from one test would otherwise leak into the next.
	if f := cronCmd.PersistentFlags().Lookup("server"); f != nil {
		_ = f.Value.Set(f.DefValue)
		f.Changed = false
	}
	cronServerFlag = ""
	if f := rootCmd.PersistentFlags().Lookup("quiet"); f != nil {
		_ = rootCmd.PersistentFlags().Set("quiet", "false")
		f.Changed = false
	}
	quiet = false
}

// runCronCmd drives `rk cron <args...>` through the real cobra Execute() seam
// (the runMuxCmd pattern) so flag parsing and exit classification run exactly
// as in production.
func runCronCmd(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	resetCronFlags()
	t.Cleanup(resetCronFlags)
	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(append([]string{"cron"}, args...))
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	err := rootCmd.Execute()
	return stdout.String(), stderr.String(), err
}

// stubCronDir redirects the cron state dir seam to a temp dir.
func stubCronDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	orig := cronDirFn
	cronDirFn = func() (string, error) { return dir, nil }
	t.Cleanup(func() { cronDirFn = orig })
	return dir
}

// stubCronTMUX points the $TMUX seam at a fake socket whose basename is the
// fake server slug ("work"), as if the caller sat in a pane on that server.
func stubCronTMUX(t *testing.T) {
	t.Helper()
	orig := cronOriginalTMUXFn
	cronOriginalTMUXFn = func() string { return "/tmp/tmux-1001/work,12,0" }
	t.Cleanup(func() { cronOriginalTMUXFn = orig })
}

// TestCronServerResolution pins the -L > $TMUX-derived > default precedence.
func TestCronServerResolution(t *testing.T) {
	origFlag, origTMUX := cronServerFlag, cronOriginalTMUXFn
	t.Cleanup(func() { cronServerFlag, cronOriginalTMUXFn = origFlag, origTMUX })

	cronOriginalTMUXFn = func() string { return "/tmp/tmux-1001/work,12,0" }
	if got := cronServer(); got != "work" {
		t.Errorf("cronServer() = %q, want %q (socket basename)", got, "work")
	}

	cronServerFlag = "other"
	if got := cronServer(); got != "other" {
		t.Errorf("cronServer() = %q, want -L to win", got)
	}
	cronServerFlag = ""

	cronOriginalTMUXFn = func() string { return "" }
	if got := cronServer(); got != "default" {
		t.Errorf("cronServer() = %q, want %q outside tmux", got, "default")
	}

	cronOriginalTMUXFn = func() string { return ",," }
	if got := cronServer(); got != "default" {
		t.Errorf("cronServer() = %q, want %q for a malformed $TMUX", got, "default")
	}
}

// TestCronSlugValidation: the resolved name must pass cron.ValidSlug before
// any path is built — a crafted socket basename or -L value errors instead of
// reaching the state dir.
func TestCronSlugValidation(t *testing.T) {
	origFlag, origTMUX := cronServerFlag, cronOriginalTMUXFn
	t.Cleanup(func() { cronServerFlag, cronOriginalTMUXFn = origFlag, origTMUX })

	cronServerFlag = "../escape"
	if _, err := cronSlug(); err == nil || !strings.Contains(err.Error(), "invalid server slug") {
		t.Errorf("cronSlug() error = %v, want an invalid-slug error", err)
	}
	cronServerFlag = ""
	cronOriginalTMUXFn = func() string { return "/tmp/tmux-1001/bad.name,0,0" }
	if _, err := cronSlug(); err == nil {
		t.Error("cronSlug() = nil error for a derived slug with a dot, want invalid")
	}
	cronOriginalTMUXFn = func() string { return "/tmp/tmux-1001/work_1-a,0,0" }
	if slug, err := cronSlug(); err != nil || slug != "work_1-a" {
		t.Errorf("cronSlug() = %q, %v, want work_1-a, nil", slug, err)
	}
}

// TestCronFamilyRegistered: the root gains exactly one cron row, and the
// family lists its six verbs with the shared -L flag inherited.
func TestCronFamilyRegistered(t *testing.T) {
	found := false
	count := 0
	for _, c := range rootCmd.Commands() {
		if c.Name() == "cron" {
			count++
			for _, sub := range c.Commands() {
				switch sub.Name() {
				case "add", "list", "rm", "mute", "pin", "tick":
				default:
					t.Errorf("unexpected cron subcommand %q", sub.Name())
				}
				if sub.Flag("server") == nil {
					t.Errorf("cron %s does not inherit the -L/--server flag", sub.Name())
				}
			}
			if len(c.Commands()) != 6 {
				t.Errorf("cron has %d subcommands, want exactly 6 (add, list, rm, mute, pin, tick)", len(c.Commands()))
			}
			found = true
		}
	}
	if !found {
		t.Fatal("cron command not registered on root")
	}
	if count != 1 {
		t.Errorf("cron registered %d times on root, want 1", count)
	}
}

// TestCronTickRejectsServerFlag: tick sweeps every live server, so an
// explicitly-set inherited -L is a usage error (exit 2) naming the flag.
func TestCronTickRejectsServerFlag(t *testing.T) {
	stubCronDir(t)
	_, _, err := runCronCmd(t, "-L", "work", "tick")
	if err == nil {
		t.Fatal("tick -L work: err = nil, want a usage error")
	}
	if code := exitCode(err); code != exitUsage {
		t.Errorf("tick -L work: exit code = %d, want %d", code, exitUsage)
	}
	if !strings.Contains(err.Error(), "--server") {
		t.Errorf("err = %v, want the rejection naming --server", err)
	}
}
