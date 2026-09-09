package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/cron"
)

// NOTE (tmux safety): list is disk-derived only — it issues ZERO tmux
// commands by construction (the code path touches the entry file and the
// delivery log, nothing else), so these tests need no tmux seam at all; an
// absent server must list fine.

const cronListFixture = `
entries:
  - id: a3f9
    name: hourly sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
    deliver: immediate
    if_absent: skip
    muted: true
    created_by: { pane: "%42", at: 1756999999 }
  - id: k7q2
    name: op tick
    schedule: { kind: backoff, min: 60s, max: 30m }
    target: { kind: role, role: operator }
    payload: "tick"
    deliver: when-idle
    pinned: true
`

func writeCronFixture(t *testing.T, dir, slug, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, slug+".yaml"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

// TestCronListEmpty: an absent entry file yields the header-only table (or []
// under --json) with exit 0.
func TestCronListEmpty(t *testing.T) {
	stubCronDir(t)
	stubCronTMUX(t)

	stdout, _, err := runCronCmd(t, "list")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if strings.Count(strings.TrimSpace(stdout), "\n") != 0 {
		t.Errorf("stdout = %q, want header only", stdout)
	}

	stdout, _, err = runCronCmd(t, "list", "--json")
	if err != nil {
		t.Fatalf("list --json: %v", err)
	}
	var records []cronListRecord
	if err := json.Unmarshal([]byte(stdout), &records); err != nil {
		t.Fatalf("unmarshal: %v (stdout %q)", err, stdout)
	}
	if len(records) != 0 {
		t.Errorf("records = %v, want empty array", records)
	}
}

// TestCronListRows: the human table carries id, name, schedule summary,
// target, deliver, flags, and the last-fired join from the delivery log.
func TestCronListRows(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", cronListFixture)
	if err := os.WriteFile(filepath.Join(dir, "work.log"), []byte(
		`{"ts":1757001111,"entry":"a3f9","target":"%42","reason":"schedule","outcome":"no-deliverer"}`+"\n"+
			`{"ts":1757002222,"entry":"a3f9","target":"%42","reason":"schedule","outcome":"no-deliverer"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stdout, _, err := runCronCmd(t, "list")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, want := range []string{
		"a3f9", "hourly sweep", "every 1h", "pane:%42", "immediate", "muted",
		"k7q2", "op tick", "backoff 1m→30m", "role:operator", "when-idle", "pinned",
	} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout missing %q:\n%s", want, stdout)
		}
	}
	// Last-fired is the NEWEST log line for the entry; k7q2 never fired.
	if want := cronListLastFired(1757002222); !strings.Contains(stdout, want) {
		t.Errorf("stdout missing the rendered last-fired %q:\n%s", want, stdout)
	}
}

// TestCronListJSON: --json emits the same records as an array, with the
// last-fired join as a unix timestamp.
func TestCronListJSON(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", cronListFixture)
	if err := os.WriteFile(filepath.Join(dir, "work.log"), []byte(
		`{"ts":1757002222,"entry":"a3f9","target":"%42","reason":"schedule","outcome":"no-deliverer"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stdout, _, err := runCronCmd(t, "list", "--json")
	if err != nil {
		t.Fatalf("list --json: %v", err)
	}
	var records []cronListRecord
	if err := json.Unmarshal([]byte(stdout), &records); err != nil {
		t.Fatalf("unmarshal: %v (stdout %q)", err, stdout)
	}
	if len(records) != 2 {
		t.Fatalf("records = %d, want 2", len(records))
	}
	if records[0].ID != "a3f9" || records[0].Schedule != "every 1h" || records[0].Target != "pane:%42" ||
		!records[0].Muted || records[0].LastFired != 1757002222 {
		t.Errorf("records[0] = %+v, want the a3f9 row with the last-fired join", records[0])
	}
	// a3f9's only log line is failed-class (never resolved evidence), so the
	// streak runs from it; unpinned ⇒ expires_at = since + OrphanTTL.
	if records[0].OrphanedSince != 1757002222 {
		t.Errorf("records[0].OrphanedSince = %d, want 1757002222", records[0].OrphanedSince)
	}
	if want := 1757002222 + int64(cron.OrphanTTL/time.Second); records[0].ExpiresAt != want {
		t.Errorf("records[0].ExpiresAt = %d, want %d", records[0].ExpiresAt, want)
	}
	// k7q2 is a role target — never a GC subject, so the streak stays zero.
	if records[1].ID != "k7q2" || !records[1].Pinned || records[1].LastFired != 0 {
		t.Errorf("records[1] = %+v, want the k7q2 row, pinned, never fired", records[1])
	}
	if records[1].OrphanedSince != 0 || records[1].ExpiresAt != 0 {
		t.Errorf("records[1] OrphanedSince/ExpiresAt = %d/%d, want 0/0 for a role target",
			records[1].OrphanedSince, records[1].ExpiresAt)
	}
}

// TestCronListToleratesCorruptEntries: a file mixing a valid entry with a
// malformed one lists the valid entry, prints a diagnostic to stderr, and
// exits 0 (the tolerant-load posture).
func TestCronListToleratesCorruptEntries(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", `
entries:
  - id: a3f9
    name: good
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
  - id: bad1
    schedule: { kind: sideways }
    target: { kind: pane, pane: "%42" }
    payload: "x"
`)

	stdout, stderr, err := runCronCmd(t, "list", "--json")
	if err != nil {
		t.Fatalf("list: %v — a corrupt entry must not fail the listing", err)
	}
	var records []cronListRecord
	if err := json.Unmarshal([]byte(stdout), &records); err != nil {
		t.Fatalf("unmarshal: %v (stdout %q)", err, stdout)
	}
	if len(records) != 1 || records[0].ID != "a3f9" {
		t.Fatalf("records = %+v, want only the valid entry", records)
	}
	if !strings.Contains(stderr, "entry-invalid") {
		t.Errorf("stderr = %q, want the entry-invalid diagnostic", stderr)
	}
}

// TestCronListMuteLease: a live lease renders muted(<remaining>) in FLAGS and
// reports effective muted + muted_until in --json; an expired lease renders
// neither (effective muted governs — no flag is needed for the lease form).
func TestCronListMuteLease(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	origNow := cronNowFn
	cronNowFn = func() time.Time { return time.Unix(1757000000, 0) }
	t.Cleanup(func() { cronNowFn = origNow })
	writeCronFixture(t, dir, "work", `
entries:
  - id: l1ve
    name: leased
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
    muted_until: 1757000240
  - id: xp1r
    name: expired lease
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%43" }
    payload: "sweep"
    muted_until: 1756999900
`)

	stdout, _, err := runCronCmd(t, "list")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !strings.Contains(stdout, "muted(4m)") {
		t.Errorf("stdout missing the lease flag \"muted(4m)\":\n%s", stdout)
	}
	if strings.Contains(stdout, "xp1r") && strings.Contains(
		stdout[strings.Index(stdout, "xp1r"):], "muted") {
		t.Errorf("expired lease row renders a muted flag:\n%s", stdout)
	}

	stdout, _, err = runCronCmd(t, "list", "--json")
	if err != nil {
		t.Fatalf("list --json: %v", err)
	}
	var raw []map[string]any
	if err := json.Unmarshal([]byte(stdout), &raw); err != nil {
		t.Fatalf("unmarshal: %v (stdout %q)", err, stdout)
	}
	if len(raw) != 2 {
		t.Fatalf("records = %d, want 2", len(raw))
	}
	if raw[0]["muted"] != true || raw[0]["muted_until"] != float64(1757000240) {
		t.Errorf("live lease record = %v, want muted:true muted_until:1757000240", raw[0])
	}
	if raw[1]["muted"] != false {
		t.Errorf("expired lease record muted = %v, want false (the effective state)", raw[1]["muted"])
	}
	if _, ok := raw[1]["muted_until"]; ok {
		t.Errorf("expired lease record carries muted_until: %v", raw[1])
	}
}
