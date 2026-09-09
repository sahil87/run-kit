package cron

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestRespawnArgv: {server} substitutes in EVERY element, the result is a
// fresh slice (the entry is never mutated), and elements without the
// placeholder pass through untouched.
func TestRespawnArgv(t *testing.T) {
	e := Entry{Respawn: []string{"rk", "operator", "-L", "{server}", "log-{server}.txt", "plain"}}

	argv := RespawnArgv(e, "runKit")
	want := []string{"rk", "operator", "-L", "runKit", "log-runKit.txt", "plain"}
	if !reflect.DeepEqual(argv, want) {
		t.Errorf("argv = %v, want %v", argv, want)
	}
	if !reflect.DeepEqual(e.Respawn, []string{"rk", "operator", "-L", "{server}", "log-{server}.txt", "plain"}) {
		t.Errorf("entry mutated: %v", e.Respawn)
	}
	// Mutating the result must not reach back into the entry.
	argv[0] = "clobbered"
	if e.Respawn[0] != "rk" {
		t.Errorf("entry aliased the returned slice: %v", e.Respawn)
	}
}

// TestRespawnDetail: the detail carries the error plus a bounded output tail —
// empty output leaves the bare error, long output is cut to its last 200 bytes.
func TestRespawnDetail(t *testing.T) {
	err := errors.New("exit status 1")

	if got := respawnDetail(err, nil); got != "exit status 1" {
		t.Errorf("no output: %q", got)
	}
	if got := respawnDetail(err, []byte("boom\n")); got != "exit status 1: boom" {
		t.Errorf("short output: %q", got)
	}

	long := strings.Repeat("x", respawnOutputTailBytes+50)
	got := respawnDetail(err, []byte(long))
	if !strings.HasPrefix(got, "exit status 1: …") {
		t.Errorf("truncated detail missing the ellipsis prefix: %.40q…", got)
	}
	if tail := got[len("exit status 1: …"):]; len(tail) != respawnOutputTailBytes {
		t.Errorf("tail = %d bytes, want %d", len(tail), respawnOutputTailBytes)
	}

	// A 2-byte rune straddling the cut: the truncation must not split it.
	split := "é" + strings.Repeat("x", respawnOutputTailBytes-1)
	got = respawnDetail(err, []byte(split))
	if !utf8.ValidString(got) {
		t.Errorf("truncated detail is not valid UTF-8: %q", got)
	}
}
