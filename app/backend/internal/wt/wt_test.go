package wt

import (
	"context"
	"os"
	"path/filepath"
	"testing"
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

// writeStub creates an executable stub script on a temp PATH dir — the same
// stub-exec pattern internal/riff uses for wt/tmux.
func writeStub(t *testing.T, dir, name, script string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile stub %s: %v", name, err)
	}
}

func TestListApps(t *testing.T) {
	t.Run("returns parsed registry from a working wt", func(t *testing.T) {
		dir := t.TempDir()
		writeStub(t, dir, "wt", "#!/bin/sh\necho '[{\"id\":\"vscode\",\"label\":\"VS Code\",\"kind\":\"editor\"}]'\n")
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
		writeStub(t, dir, "wt", "#!/bin/sh\necho 'unknown flag: --list' >&2\nexit 2\n")
		t.Setenv("PATH", dir)
		if _, err := ListApps(context.Background()); err == nil {
			t.Fatal("expected error for non-zero wt exit")
		}
	})

	t.Run("errors on non-JSON stdout", func(t *testing.T) {
		dir := t.TempDir()
		writeStub(t, dir, "wt", "#!/bin/sh\necho 'Opened.'\n")
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
		writeStub(t, dir, "wt", "#!/bin/sh\necho \"$@\" > "+argvLog+"\n")
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
		writeStub(t, dir, "wt", "#!/bin/sh\necho 'no such app' >&2\nexit 1\n")
		t.Setenv("PATH", dir)
		if err := Open(context.Background(), "/tmp/proj", "nope"); err == nil {
			t.Fatal("expected error for failing wt open")
		}
	})
}
