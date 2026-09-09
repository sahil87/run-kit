package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// NOTE (tmux safety): rm/mute/pin mutate the entry file on local disk only —
// no tmux subprocess on any path.

// seedCronEntry writes the fixture file and returns its path.
func seedCronEntry(t *testing.T, dir string) string {
	t.Helper()
	writeCronFixture(t, dir, "work", `
entries:
  - id: a3f9
    name: hourly sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
`)
	return filepath.Join(dir, "work.yaml")
}

// TestCronRmMutePin: the mutation verbs flip/remove via the cron helpers,
// confirm on stdout, and --off unsets.
func TestCronRmMutePin(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	seedCronEntry(t, dir)

	stdout, _, err := runCronCmd(t, "mute", "a3f9")
	if err != nil || !strings.Contains(stdout, "muted a3f9") {
		t.Fatalf("mute: stdout=%q err=%v, want a muted confirmation", stdout, err)
	}
	if e := loadCronEntries(t, dir, "work"); !e[0].Muted {
		t.Error("muted = false after mute, want true")
	}

	stdout, _, err = runCronCmd(t, "mute", "a3f9", "--off")
	if err != nil || !strings.Contains(stdout, "unmuted a3f9") {
		t.Fatalf("mute --off: stdout=%q err=%v, want an unmuted confirmation", stdout, err)
	}
	if e := loadCronEntries(t, dir, "work"); e[0].Muted {
		t.Error("muted = true after mute --off, want false")
	}

	stdout, _, err = runCronCmd(t, "pin", "a3f9")
	if err != nil || !strings.Contains(stdout, "pinned a3f9") {
		t.Fatalf("pin: stdout=%q err=%v, want a pinned confirmation", stdout, err)
	}
	if e := loadCronEntries(t, dir, "work"); !e[0].Pinned {
		t.Error("pinned = false after pin, want true")
	}

	if _, _, err := runCronCmd(t, "pin", "a3f9", "--off"); err != nil {
		t.Fatalf("pin --off: %v", err)
	}
	if e := loadCronEntries(t, dir, "work"); e[0].Pinned {
		t.Error("pinned = true after pin --off, want false")
	}

	stdout, _, err = runCronCmd(t, "rm", "a3f9")
	if err != nil || !strings.Contains(stdout, "removed a3f9") {
		t.Fatalf("rm: stdout=%q err=%v, want a removed confirmation", stdout, err)
	}
	if e := loadCronEntries(t, dir, "work"); len(e) != 0 {
		t.Errorf("entries = %v after rm, want empty", e)
	}
}

// TestCronMutUnknownID: an unknown id exits non-zero with `no entry <id>` on
// stderr across all three verbs.
func TestCronMutUnknownID(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	seedCronEntry(t, dir)

	for _, args := range [][]string{{"rm", "zzzz"}, {"mute", "zzzz"}, {"pin", "zzzz"}, {"mute", "zzzz", "--off"}} {
		_, _, err := runCronCmd(t, args...)
		if err == nil {
			t.Fatalf("%v: err = nil, want non-zero", args)
		}
		if !strings.Contains(err.Error(), "no entry zzzz") {
			t.Errorf("%v: err = %v, want `no entry zzzz`", args, err)
		}
	}
}

// TestCronMutCorruptFileRefuses: a corrupt entry file makes every mutation
// verb exit non-zero without truncating the file.
func TestCronMutCorruptFileRefuses(t *testing.T) {
	for _, args := range [][]string{{"rm", "a3f9"}, {"mute", "a3f9"}, {"pin", "a3f9"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			dir := stubCronDir(t)
			stubCronTMUX(t)
			path := filepath.Join(dir, "work.yaml")
			corrupt := []byte("{{{{ not yaml")
			if err := os.WriteFile(path, corrupt, 0o600); err != nil {
				t.Fatal(err)
			}
			_, _, err := runCronCmd(t, args...)
			if err == nil || !strings.Contains(err.Error(), "refusing to mutate") {
				t.Fatalf("err = %v, want the refusing-to-mutate error", err)
			}
			after, _ := os.ReadFile(path)
			if string(after) != string(corrupt) {
				t.Error("corrupt entry file was modified by a refused mutation")
			}
		})
	}
}

// TestCronMuteFor: --for <dur> writes a muted_until lease (and no muted flag)
// and confirms with the RFC3339 expiry; the clock is pinned via cronNowFn.
func TestCronMuteFor(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	seedCronEntry(t, dir)
	origNow := cronNowFn
	cronNowFn = func() time.Time { return time.Unix(1757000000, 0).In(time.Local) }
	t.Cleanup(func() { cronNowFn = origNow })

	stdout, _, err := runCronCmd(t, "mute", "a3f9", "--for", "5m")
	if err != nil {
		t.Fatalf("mute --for: %v", err)
	}
	wantUntil := time.Unix(1757000000, 0).In(time.Local).Add(5 * time.Minute)
	if want := "muted a3f9 until " + wantUntil.Format(time.RFC3339); !strings.Contains(stdout, want) {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].MutedUntil != wantUntil.Unix() {
		t.Fatalf("entries = %+v, want muted_until %d", entries, wantUntil.Unix())
	}
	if entries[0].Muted {
		t.Error("muted flag set alongside the lease — a lease clears the indefinite flag")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "work.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "muted_until:") {
		t.Errorf("file = %s, want a muted_until key", raw)
	}
	if strings.Contains(string(raw), "muted: ") {
		t.Errorf("file = %s, want no muted: key", raw)
	}
}

// TestCronMuteForUsageErrors: --for 0s, a negative duration, and --for with
// --off are usage-class (exit 2) and leave the file untouched.
func TestCronMuteForUsageErrors(t *testing.T) {
	for _, args := range [][]string{
		{"mute", "a3f9", "--for", "0s"},
		{"mute", "a3f9", "--for", "-5m"},
		{"mute", "a3f9", "--for", "5m", "--off"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			dir := stubCronDir(t)
			stubCronTMUX(t)
			path := seedCronEntry(t, dir)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = runCronCmd(t, args...)
			if err == nil {
				t.Fatalf("%v: err = nil, want a usage error", args)
			}
			if code := exitCode(err); code != exitUsage {
				t.Errorf("%v: exit code = %d, want %d", args, code, exitUsage)
			}
			after, _ := os.ReadFile(path)
			if string(after) != string(before) {
				t.Errorf("%v: entry file modified by a rejected mutation", args)
			}
		})
	}
}
