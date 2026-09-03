package wt

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"rk/internal/testutil"
)

func TestParseApps(t *testing.T) {
	t.Run("parses valid entries and ignores unknown fields", func(t *testing.T) {
		data := []byte(`[
			{"id":"vscode","label":"VS Code","kind":"editor","future":"x"},
			{"id":"iterm","label":"iTerm","kind":"terminal"}
		]`)
		apps, err := parseApps(data)
		if err != nil {
			t.Fatalf("parseApps error: %v", err)
		}
		if len(apps) != 2 {
			t.Fatalf("len = %d, want 2", len(apps))
		}
		if apps[0] != (App{ID: "vscode", Label: "VS Code", Kind: "editor"}) {
			t.Errorf("apps[0] = %+v", apps[0])
		}
		if apps[1] != (App{ID: "iterm", Label: "iTerm", Kind: "terminal"}) {
			t.Errorf("apps[1] = %+v", apps[1])
		}
	})

	t.Run("skips entries missing id or label", func(t *testing.T) {
		data := []byte(`[
			{"label":"No ID"},
			{"id":"nolabel"},
			{"id":"ok","label":"OK"}
		]`)
		apps, err := parseApps(data)
		if err != nil {
			t.Fatalf("parseApps error: %v", err)
		}
		if len(apps) != 1 || apps[0].ID != "ok" {
			t.Fatalf("apps = %+v, want single 'ok' entry", apps)
		}
	})

	t.Run("kind is optional", func(t *testing.T) {
		apps, err := parseApps([]byte(`[{"id":"a","label":"A"}]`))
		if err != nil {
			t.Fatalf("parseApps error: %v", err)
		}
		if len(apps) != 1 || apps[0].Kind != "" {
			t.Fatalf("apps = %+v, want one entry with empty kind", apps)
		}
	})

	t.Run("empty array parses to empty slice", func(t *testing.T) {
		apps, err := parseApps([]byte(`[]`))
		if err != nil {
			t.Fatalf("parseApps error: %v", err)
		}
		if len(apps) != 0 {
			t.Fatalf("len = %d, want 0", len(apps))
		}
	})

	t.Run("filters to gui locus, keeping locus-less rows", func(t *testing.T) {
		data := []byte(`[
			{"id":"code","label":"VS Code","kind":"editor","locus":"gui"},
			{"id":"open_here","label":"Open here","kind":"shell","locus":"caller"},
			{"id":"tmux_window","label":"tmux window","kind":"multiplexer","locus":"session"},
			{"id":"copy_path","label":"Copy path","kind":"clipboard","locus":"host"},
			{"id":"legacy","label":"Legacy App","kind":"editor"}
		]`)
		apps, err := parseApps(data)
		if err != nil {
			t.Fatalf("parseApps error: %v", err)
		}
		if len(apps) != 2 || apps[0].ID != "code" || apps[1].ID != "legacy" {
			t.Fatalf("apps = %+v, want gui 'code' + locus-less 'legacy'", apps)
		}
	})

	t.Run("all-non-gui registry parses to empty slice", func(t *testing.T) {
		// The registry observed on a headless host: action rows only, no GUI
		// apps — the filtered result must be empty so the UI hides the section.
		data := []byte(`[
			{"id":"open_here","label":"Open here","kind":"shell","locus":"caller"},
			{"id":"tmux_window","label":"tmux window","kind":"multiplexer","locus":"session","default":true},
			{"id":"tmux_session","label":"tmux session","kind":"multiplexer","locus":"session"}
		]`)
		apps, err := parseApps(data)
		if err != nil {
			t.Fatalf("parseApps error: %v", err)
		}
		if len(apps) != 0 {
			t.Fatalf("apps = %+v, want empty (default marker on a dropped row must not leak)", apps)
		}
	})

	t.Run("default marker decoded on surviving gui rows", func(t *testing.T) {
		data := []byte(`[
			{"id":"code","label":"VS Code","kind":"editor","locus":"gui","default":true},
			{"id":"cursor","label":"Cursor","kind":"editor","locus":"gui"}
		]`)
		apps, err := parseApps(data)
		if err != nil {
			t.Fatalf("parseApps error: %v", err)
		}
		if len(apps) != 2 || !apps[0].Default || apps[1].Default {
			t.Fatalf("apps = %+v, want default only on 'code'", apps)
		}
	})

	t.Run("non-JSON output errors", func(t *testing.T) {
		if _, err := parseApps([]byte("Usage: wt open <path>")); err == nil {
			t.Fatal("expected error for non-JSON output")
		}
	})

	t.Run("non-array JSON errors", func(t *testing.T) {
		if _, err := parseApps([]byte(`{"id":"vscode"}`)); err == nil {
			t.Fatal("expected error for non-array JSON")
		}
	})
}

func TestListApps(t *testing.T) {
	t.Run("returns parsed registry from a working wt", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "wt", "#!/bin/sh\necho '[{\"id\":\"vscode\",\"label\":\"VS Code\",\"kind\":\"editor\"}]'\n")
		t.Setenv("PATH", dir)

		apps, err := ListApps(context.Background())
		if err != nil {
			t.Fatalf("ListApps error: %v", err)
		}
		if len(apps) != 1 || apps[0].ID != "vscode" {
			t.Fatalf("apps = %+v, want single vscode entry", apps)
		}
	})

	t.Run("errors when wt is absent", func(t *testing.T) {
		t.Setenv("PATH", t.TempDir()) // empty dir — no wt
		if _, err := ListApps(context.Background()); err == nil {
			t.Fatal("expected error when wt is absent")
		}
	})

	t.Run("errors when wt is too old (unknown flag, non-zero exit)", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "wt", "#!/bin/sh\necho 'unknown flag: --list' >&2\nexit 2\n")
		t.Setenv("PATH", dir)
		if _, err := ListApps(context.Background()); err == nil {
			t.Fatal("expected error for non-zero wt exit")
		}
	})

	t.Run("errors on non-JSON stdout", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "wt", "#!/bin/sh\necho 'Opened.'\n")
		t.Setenv("PATH", dir)
		if _, err := ListApps(context.Background()); err == nil {
			t.Fatal("expected error for non-JSON output")
		}
	})
}

func TestOpen(t *testing.T) {
	t.Run("invokes wt open <path> -a <app>", func(t *testing.T) {
		dir := t.TempDir()
		argvLog := filepath.Join(dir, "argv.log")
		testutil.WriteStub(t, dir, "wt", "#!/bin/sh\necho \"$@\" > "+argvLog+"\n")
		t.Setenv("PATH", dir)

		if err := Open(context.Background(), "/tmp/proj", "vscode"); err != nil {
			t.Fatalf("Open error: %v", err)
		}
		got, err := os.ReadFile(argvLog)
		if err != nil {
			t.Fatalf("read argv log: %v", err)
		}
		if want := "open /tmp/proj -a vscode\n"; string(got) != want {
			t.Errorf("argv = %q, want %q", got, want)
		}
	})

	t.Run("propagates launch failure with output", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "wt", "#!/bin/sh\necho 'no such app' >&2\nexit 1\n")
		t.Setenv("PATH", dir)
		if err := Open(context.Background(), "/tmp/proj", "nope"); err == nil {
			t.Fatal("expected error for failing wt open")
		}
	})
}
