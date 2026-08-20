package snapshot

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestRestorableOffers_ExcludesInfraTombstoneAndLive(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

	// A live-latest for kit (orphaned), one per infra name, and a tombstone
	// for old. Only `dev` has a live socket.
	for _, server := range []string{"kit", "rk-daemon", "rk-jobs", "rk-code-server", "rk-remotes", "rk-test-unit-1", "old"} {
		if _, err := s.Write(testSnap(server, base, "serve")); err != nil {
			t.Fatalf("write %s: %v", server, err)
		}
	}
	if _, err := s.Tombstone("old", base.Add(time.Hour), false); err != nil {
		t.Fatalf("tombstone old: %v", err)
	}

	offers, err := s.RestorableOffers([]string{"dev"})
	if err != nil {
		t.Fatal(err)
	}
	if len(offers) != 1 || offers[0].Server != "kit" {
		t.Fatalf("offers = %+v, want exactly [kit]", offers)
	}

	// A live-latest whose server has a live socket is not offered.
	offers, err = s.RestorableOffers([]string{"dev", "kit"})
	if err != nil {
		t.Fatal(err)
	}
	if len(offers) != 0 {
		t.Fatalf("offers = %+v, want none (kit is alive)", offers)
	}
}

func TestRestorableOffers_EmptyStore(t *testing.T) {
	s := NewStore(t.TempDir())
	offers, err := s.RestorableOffers(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(offers) != 0 {
		t.Fatalf("offers = %+v, want empty", offers)
	}
	// Wire form is `[]`, never null.
	if offers == nil {
		t.Fatal("offers must be a non-nil empty slice")
	}
}

func TestRestorableOffers_PayloadTree(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

	snap := &Snapshot{
		Server:  "kit",
		TakenAt: base,
		Sessions: []Session{{
			Name:      "s1",
			CreatedAt: 100,
			Color:     "blue",
			Windows: []Window{
				{
					Index: 2, ID: "@2", Name: "w2",
					Panes: []Pane{{ID: "%2", Index: 0, Cwd: "/tmp", Command: "zsh"}},
				},
				{
					Index: 1, ID: "@1", Name: "w1",
					Panes: []Pane{
						{ID: "%0", Index: 0, Cwd: "/tmp", Command: "claude --dangerously-skip-permissions"},
						{ID: "%1", Index: 1, Cwd: "/tmp"}, // empty command omitted
					},
				},
			},
		}},
	}
	if _, err := s.Write(snap); err != nil {
		t.Fatal(err)
	}

	offers, err := s.RestorableOffers(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(offers) != 1 {
		t.Fatalf("offers = %+v, want exactly one", offers)
	}
	o := offers[0]
	if o.Server != "kit" || !o.TakenAt.Equal(base) {
		t.Errorf("offer identity = %q %v, want kit %v", o.Server, o.TakenAt, base)
	}
	if o.SessionCount != 1 || o.WindowCount != 2 {
		t.Errorf("counts = %d/%d, want 1/2", o.SessionCount, o.WindowCount)
	}
	if len(o.Sessions) != 1 || o.Sessions[0].Name != "s1" || o.Sessions[0].Color != "blue" {
		t.Errorf("session = %+v, want s1/blue", o.Sessions)
	}
	ws := o.Sessions[0].Windows
	if len(ws) != 2 {
		t.Fatalf("windows = %+v, want 2", ws)
	}
	// Windows serialize in index order regardless of stored order.
	if ws[0].Index != 1 || ws[1].Index != 2 {
		t.Fatalf("window order = %d,%d, want 1,2", ws[0].Index, ws[1].Index)
	}
	// R2: a window with a `claude` pane command is resumable; a zsh window not.
	if !ws[0].Resumable || ws[1].Resumable {
		t.Errorf("resumable = %v/%v, want true/false", ws[0].Resumable, ws[1].Resumable)
	}
	if len(ws[0].Commands) != 1 || ws[0].Commands[0] != "claude --dangerously-skip-permissions" {
		t.Errorf("w1 commands = %v, want [claude --dangerously-skip-permissions] (empty omitted)", ws[0].Commands)
	}
	if ws[0].PaneCount != 2 || ws[1].PaneCount != 1 {
		t.Errorf("paneCounts = %d/%d, want 2/1", ws[0].PaneCount, ws[1].PaneCount)
	}

	// The wire contract carries the pinned field names.
	data, err := json.Marshal(o)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	for _, want := range []string{
		`"server":"kit"`, `"takenAt":"2026-08-20T12:00:00Z"`,
		`"sessionCount":1`, `"windowCount":2`, `"sessions":[{`,
		`"name":"s1"`, `"color":"blue"`, `"windows":[{`,
		`"index":1`, `"paneCount":2`, `"commands":["claude --dangerously-skip-permissions"]`,
		`"resumable":true`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("payload missing %s — body=%s", want, body)
		}
	}
}

func TestIsClaudeCommand(t *testing.T) {
	cases := []struct {
		command string
		want    bool
	}{
		{"claude", true},
		{"claude -c", true},
		{"/path/to/claude --flags", true},
		{"claudeify", false},
		{"/opt/claudeify run", false},
		{"zsh", false},
		{"", false},
		{"   ", false},
	}
	for _, c := range cases {
		if got := isClaudeCommand(c.command); got != c.want {
			t.Errorf("isClaudeCommand(%q) = %v, want %v", c.command, got, c.want)
		}
	}
}

func TestInfraServerName(t *testing.T) {
	for _, name := range []string{"rk-daemon", "rk-jobs", "rk-code-server", "rk-remotes", "rk-test-e2e", "rk-test-unit-1"} {
		if !infraServerName(name) {
			t.Errorf("infraServerName(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"kit", "default", "rk-daemon-x", "rk-jobs-2"} {
		if infraServerName(name) {
			t.Errorf("infraServerName(%q) = true, want false", name)
		}
	}
}
