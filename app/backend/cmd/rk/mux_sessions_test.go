package main

import (
	"errors"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// defaultSessionFactsFixture is the muxFake default: one attached user session,
// one plain user session, and the three infrastructure kinds plus a reserved
// stranger — the mixed population the default/--all filter split is about.
func defaultSessionFactsFixture() []tmux.SessionFacts {
	return []tmux.SessionFacts{
		{Name: "fabKit", Role: tmux.SessionRoleUser, Attached: 1, Windows: 15, Path: "/home/x/fab-kit", Grouped: true},
		{Name: "_rk-ctl", Role: tmux.SessionRoleControl, Attached: 0, Windows: 15, Path: "/home/x", Grouped: true},
		{Name: "scratch", Role: tmux.SessionRoleUser, Attached: 0, Windows: 2, Path: "/home/x/scratch", Grouped: false},
		{Name: "_rk-pin-42", Role: tmux.SessionRolePin, Attached: 0, Windows: 1, Path: "/home/x", Grouped: false},
		{Name: "_rk-operator", Role: tmux.SessionRoleOperator, Attached: 0, Windows: 1, Path: "/home/x", Grouped: false},
		{Name: "_rk-future", Role: tmux.SessionRoleReserved, Attached: 0, Windows: 1, Path: "/home/x", Grouped: false},
	}
}

// TestMuxSessionsDefaultFiltersInfrastructure: the default listing is the
// user-facing candidate set — every infrastructure role is absent (R3).
func TestMuxSessionsDefaultFiltersInfrastructure(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "sessions")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	for _, name := range []string{"fabKit", "scratch"} {
		if !strings.Contains(stdout, name) {
			t.Errorf("stdout = %q, want user session %q listed", stdout, name)
		}
	}
	for _, name := range []string{"_rk-ctl", "_rk-pin-42", "_rk-operator", "_rk-future"} {
		if strings.Contains(stdout, name) {
			t.Errorf("stdout = %q, infrastructure session %q must not list by default", stdout, name)
		}
	}
	if !strings.Contains(stdout, "NAME") || !strings.Contains(stdout, "ROLE") {
		t.Errorf("stdout = %q, want the table header", stdout)
	}
}

// TestMuxSessionsAllIncludesRoles: --all lists every session labeled with its
// derived role (R3).
func TestMuxSessionsAllIncludesRoles(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "sessions", "--all")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	for _, want := range []string{"_rk-ctl", "control", "_rk-pin-42", "pin", "_rk-operator", "operator", "_rk-future", "reserved"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout = %q, want %q under --all", stdout, want)
		}
	}
}

// TestMuxSessionsJSONShape: --json carries exactly the documented key set in
// the documented order (R4).
func TestMuxSessionsJSONShape(t *testing.T) {
	f := &muxFake{sessionFacts: []tmux.SessionFacts{
		{Name: "fabKit", Role: tmux.SessionRoleUser, Attached: 1, Windows: 15, Path: "/home/x/fab-kit", Grouped: true},
	}}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "sessions", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	want := "[\n" +
		"  {\n" +
		"    \"name\": \"fabKit\",\n" +
		"    \"role\": \"user\",\n" +
		"    \"attached\": 1,\n" +
		"    \"windows\": 15,\n" +
		"    \"path\": \"/home/x/fab-kit\",\n" +
		"    \"grouped\": true\n" +
		"  }\n" +
		"]\n"
	if stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	// Substrate facts only: no choreography keys (cli-layering delegation).
	for _, key := range []string{"change", "stage", "display_state"} {
		if strings.Contains(stdout, `"`+key+`"`) {
			t.Errorf("stdout carries choreography key %q, want substrate facts only", key)
		}
	}
}

// TestMuxSessionsEmptyAlive: an alive server with nothing to list is success —
// `[]` under --json, exit 0 (R4).
func TestMuxSessionsEmptyAlive(t *testing.T) {
	f := &muxFake{sessionFactsSet: true}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "sessions", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "[]\n" {
		t.Errorf("stdout = %q, want %q", stdout, "[]\n")
	}
}

// TestMuxSessionsDeadServerOperational: an empty enumeration on a dead socket
// is an operational failure carrying tmux's diagnostic (R4).
func TestMuxSessionsDeadServerOperational(t *testing.T) {
	f := &muxFake{sessionFactsSet: true, sessionAliveErr: errors.New("no server running on /tmp/tmux-1000/nope")}
	installMuxFakes(t, f)

	_, _, err := runMuxCmd(t, "sessions", "--json")
	if err == nil {
		t.Fatal("want an operational error for a dead socket")
	}
	if !strings.Contains(err.Error(), "no server running") {
		t.Errorf("err = %v, want tmux's diagnostic carried through", err)
	}
}

// TestMuxSessionsStrayArgUsage: an enumeration query takes no positional
// target — a stray argument is a usage error (R1).
func TestMuxSessionsStrayArgUsage(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "sessions", "work")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("err = %v, want usage exit 2", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q on a usage error, want empty", stdout)
	}
}
