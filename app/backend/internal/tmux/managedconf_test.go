package tmux

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withTempDefaultConfig points DefaultConfigPath at a temp dir for the test's
// duration, returning the config path. It also stubs HOME (EnsureConfig runs
// migrateLegacyConfPaths, which resolves ~/.rk from os.UserHomeDir at call
// time — without the stub a test mutates the developer's real ~/.rk) and pins
// the managed-path gate (init-time resolution of a real tmux_conf/RK_TMUX_CONF
// would otherwise turn EnsureConfig into a silent no-op).
func withTempDefaultConfig(t *testing.T) string {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	orig := DefaultConfigPath
	dest := filepath.Join(t.TempDir(), ".config", "run-kit", "tmux.conf")
	DefaultConfigPath = dest
	t.Cleanup(func() { DefaultConfigPath = orig })
	origManaged := managedConfigPath
	managedConfigPath = true
	t.Cleanup(func() { managedConfigPath = origManaged })
	return dest
}

// TestClassifyManagedConf is the table-driven three-state decision: every
// fixture shape maps to exactly one classification.
func TestClassifyManagedConf(t *testing.T) {
	embed := DefaultConfigBytes()
	managed := ManagedConfigBytes(embed)

	// A stale fixture: a validly-stamped file whose body is NOT the current
	// embed (an rk-written file an embed change left behind).
	oldBody := []byte("set -g history-limit 2000\n")
	stale := ManagedConfigBytes(oldBody)

	// A hash-mismatch fixture: the header's stamp no longer matches the body
	// (the user edited below the header).
	tampered := bytes.Replace(managed, []byte("history-limit 100000"), []byte("history-limit 999"), 1)

	cases := []struct {
		name    string
		content []byte
		want    ConfState
	}{
		{"managed current", managed, ConfManagedCurrent},
		{"managed stale", stale, ConfManagedStale},
		{"no header", embed, ConfHandEdited},
		{"hash mismatch", tampered, ConfHandEdited},
		{"empty file", nil, ConfHandEdited},
		{"whitespace only", []byte("  \n\n"), ConfHandEdited},
		{"header only, no body", []byte("# rk-managed sha256:" + managedHash(nil) + managedHeaderSuffix + "\n"), ConfManagedStale},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ClassifyManagedConf(c.content, embed); got != c.want {
				t.Errorf("ClassifyManagedConf = %v, want %v", got, c.want)
			}
		})
	}
}

// TestManagedConfigBytesStampVerifies pins the write contract: line 1 is the
// managed header and the stamp equals SHA-256 of the body.
func TestManagedConfigBytesStampVerifies(t *testing.T) {
	body := []byte("set -g exit-empty off\n")
	out := ManagedConfigBytes(body)
	line, rest, found := bytes.Cut(out, []byte("\n"))
	if !found {
		t.Fatal("managed file must have a header line followed by the body")
	}
	wantHeader := "# rk-managed sha256:" + managedHash(body) + managedHeaderSuffix
	if string(line) != wantHeader {
		t.Errorf("header = %q, want %q", line, wantHeader)
	}
	if !bytes.Equal(rest, body) {
		t.Errorf("body = %q, want %q (byte-identical)", rest, body)
	}
	// The stamp must verify when the file is classified back.
	if got := ClassifyManagedConf(out, body); got != ConfManagedCurrent {
		t.Errorf("round-trip classification = %v, want ConfManagedCurrent", got)
	}
}

// TestClassifyConfigFile covers the filesystem layer: missing maps to
// ConfMissing, present files defer to the content classifier.
func TestClassifyConfigFile(t *testing.T) {
	dest := withTempDefaultConfig(t)

	if got, err := ClassifyConfigFile(dest); err != nil || got != ConfMissing {
		t.Errorf("absent file = (%v, %v), want (ConfMissing, nil)", got, err)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, ManagedConfigBytes(DefaultConfigBytes()), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := ClassifyConfigFile(dest); err != nil || got != ConfManagedCurrent {
		t.Errorf("managed file = (%v, %v), want (ConfManagedCurrent, nil)", got, err)
	}
}

// TestEnsureConfigThreeState pins the refresh behavior per state: missing and
// stale write (stale reports refreshed), current and hand-edited leave the
// file byte-identical.
func TestEnsureConfigThreeState(t *testing.T) {
	t.Run("missing writes the stamped embed", func(t *testing.T) {
		dest := withTempDefaultConfig(t)
		refreshed, err := EnsureConfig()
		if err != nil {
			t.Fatalf("EnsureConfig() error: %v", err)
		}
		if refreshed {
			t.Error("missing→write must not report refreshed (no server ran with older content)")
		}
		data, err := os.ReadFile(dest)
		if err != nil {
			t.Fatalf("config not written: %v", err)
		}
		if !bytes.Equal(data, ManagedConfigBytes(DefaultConfigBytes())) {
			t.Error("written file must be the stamped embed")
		}
	})

	t.Run("managed current is a no-op", func(t *testing.T) {
		dest := withTempDefaultConfig(t)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			t.Fatal(err)
		}
		managed := ManagedConfigBytes(DefaultConfigBytes())
		if err := os.WriteFile(dest, managed, 0o644); err != nil {
			t.Fatal(err)
		}
		refreshed, err := EnsureConfig()
		if err != nil {
			t.Fatalf("EnsureConfig() error: %v", err)
		}
		if refreshed {
			t.Error("current file must not report refreshed")
		}
		data, _ := os.ReadFile(dest)
		if !bytes.Equal(data, managed) {
			t.Error("current file must stay byte-identical")
		}
	})

	t.Run("managed stale force-writes and reports refreshed", func(t *testing.T) {
		dest := withTempDefaultConfig(t)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			t.Fatal(err)
		}
		stale := ManagedConfigBytes([]byte("set -g history-limit 2000\n"))
		if err := os.WriteFile(dest, stale, 0o644); err != nil {
			t.Fatal(err)
		}
		refreshed, err := EnsureConfig()
		if err != nil {
			t.Fatalf("EnsureConfig() error: %v", err)
		}
		if !refreshed {
			t.Error("stale→force-write must report refreshed so the caller sweeps")
		}
		data, _ := os.ReadFile(dest)
		if !bytes.Equal(data, ManagedConfigBytes(DefaultConfigBytes())) {
			t.Error("stale file must be force-written with the current stamped embed")
		}
	})

	t.Run("hand-edited is left untouched", func(t *testing.T) {
		dest := withTempDefaultConfig(t)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			t.Fatal(err)
		}
		edited := []byte("# my own tmux.conf\nset -g prefix C-a\n")
		if err := os.WriteFile(dest, edited, 0o644); err != nil {
			t.Fatal(err)
		}
		refreshed, err := EnsureConfig()
		if err != nil {
			t.Fatalf("EnsureConfig() error: %v", err)
		}
		if refreshed {
			t.Error("hand-edited must not report refreshed")
		}
		data, _ := os.ReadFile(dest)
		if !bytes.Equal(data, edited) {
			t.Error("hand-edited file must never be clobbered")
		}
	})
}

// TestEnsureConfigUserOwnedPathIsNoop pins the "you own everything" gate: when
// the resolved config path is user-owned (tmux_conf or RK_TMUX_CONF redirected
// it), EnsureConfig writes nothing — no conf, no tmux.d/, no user.conf
// scaffold, no refresh report. The gate rides the managedConfigPath package
// var (fixed at init from the resolved path), flipped here the same way the
// sweep seams are substituted.
func TestEnsureConfigUserOwnedPathIsNoop(t *testing.T) {
	dest := withTempDefaultConfig(t)
	managedConfigPath = false

	refreshed, err := EnsureConfig()
	if err != nil {
		t.Fatalf("EnsureConfig() error: %v", err)
	}
	if refreshed {
		t.Error("user-owned path must never report refreshed")
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Errorf("user-owned path: tmux.conf must not be written, stat err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dest), "tmux.d")); !os.IsNotExist(err) {
		t.Errorf("user-owned path: tmux.d/ must not be scaffolded, stat err = %v", err)
	}
}

// TestEnsureConfigScaffoldsUserConf pins the override scaffold: user.conf is
// created when absent and never overwritten — including under ForceWriteConfig
// (the --force path).
func TestEnsureConfigScaffoldsUserConf(t *testing.T) {
	dest := withTempDefaultConfig(t)
	if _, err := EnsureConfig(); err != nil {
		t.Fatalf("EnsureConfig() error: %v", err)
	}
	userConf := filepath.Join(filepath.Dir(dest), "tmux.d", "user.conf")
	starter, err := os.ReadFile(userConf)
	if err != nil {
		t.Fatalf("user.conf starter not scaffolded: %v", err)
	}
	if !strings.Contains(string(starter), "10-*.conf") {
		t.Errorf("starter must point at numeric-prefix ordering, got: %q", starter)
	}

	mine := []byte("# my overrides\nset -g status off\n")
	if err := os.WriteFile(userConf, mine, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ForceWriteConfig(); err != nil {
		t.Fatalf("ForceWriteConfig() error: %v", err)
	}
	after, _ := os.ReadFile(userConf)
	if !bytes.Equal(after, mine) {
		t.Error("user.conf must survive ForceWriteConfig byte-identical")
	}
	data, _ := os.ReadFile(dest)
	if !bytes.Equal(data, ManagedConfigBytes(DefaultConfigBytes())) {
		t.Error("ForceWriteConfig must write the stamped embed")
	}
}

// TestMigrateLegacyConfPaths pins migration 2: legacy drop-ins move (a
// same-name file at the new path wins), the old dir is breadcrumbed, and an
// old tmux.conf is breadcrumb-renamed only when byte-equal to the embed.
func TestMigrateLegacyConfPaths(t *testing.T) {
	// DefaultConfigPath must live under the temp HOME for the migration to
	// see the temp legacy root.
	home := t.TempDir()
	t.Setenv("HOME", home)
	orig := DefaultConfigPath
	DefaultConfigPath = filepath.Join(home, ".config", "run-kit", "tmux.conf")
	t.Cleanup(func() { DefaultConfigPath = orig })

	legacyDir := filepath.Join(home, ".rk", "tmux.d")
	newDir := filepath.Join(home, ".config", "run-kit", "tmux.d")
	if err := os.MkdirAll(legacyDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacyOnly := []byte("set -g status off\n")
	conflictOld := []byte("# old version\n")
	conflictNew := []byte("# new version — must win\n")
	for name, content := range map[string][]byte{
		"10-colors.conf": legacyOnly,
		"user.conf":      conflictOld,
	} {
		if err := os.WriteFile(filepath.Join(legacyDir, name), content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(newDir, "user.conf"), conflictNew, 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("drop-ins move, conflicts keep the new file, old dir breadcrumbed", func(t *testing.T) {
		migrateLegacyConfPaths()

		got, err := os.ReadFile(filepath.Join(newDir, "10-colors.conf"))
		if err != nil || !bytes.Equal(got, legacyOnly) {
			t.Errorf("moved drop-in = %q, %v — want the legacy content", got, err)
		}
		got, err = os.ReadFile(filepath.Join(newDir, "user.conf"))
		if err != nil || !bytes.Equal(got, conflictNew) {
			t.Errorf("conflicting drop-in = %q, %v — the new path must win", got, err)
		}
		if _, err := os.Stat(legacyDir); !os.IsNotExist(err) {
			t.Errorf("legacy tmux.d must be breadcrumbed away, stat err = %v", err)
		}
		if _, err := os.Stat(legacyDir + ".migrated"); err != nil {
			t.Errorf("breadcrumb tmux.d.migrated missing: %v", err)
		}
	})

	t.Run("byte-equal legacy conf is breadcrumb-renamed", func(t *testing.T) {
		legacyConf := filepath.Join(home, ".rk", "tmux.conf")
		if err := os.WriteFile(legacyConf, DefaultConfigBytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		migrateLegacyConfPaths()
		if _, err := os.Stat(legacyConf); !os.IsNotExist(err) {
			t.Errorf("byte-equal legacy conf must be renamed away, stat err = %v", err)
		}
		if _, err := os.Stat(legacyConf + ".migrated"); err != nil {
			t.Errorf("breadcrumb tmux.conf.migrated missing: %v", err)
		}
	})

	t.Run("non-embed legacy conf is left untouched", func(t *testing.T) {
		legacyConf := filepath.Join(home, ".rk", "tmux.conf")
		edited := []byte("# hand-tuned\nset -g prefix C-a\n")
		if err := os.WriteFile(legacyConf, edited, 0o644); err != nil {
			t.Fatal(err)
		}
		migrateLegacyConfPaths()
		got, err := os.ReadFile(legacyConf)
		if err != nil || !bytes.Equal(got, edited) {
			t.Errorf("hand-edited legacy conf = %q, %v — must stay untouched", got, err)
		}
	})
}

// TestRefreshSweep pins the live-only sweep contract: exactly the enumerated
// (live) servers are reloaded, a per-server error does not abort the rest, and
// an enumeration error degrades to a logged skip.
func TestRefreshSweep(t *testing.T) {
	stub := func(t *testing.T, servers []string, listErr error, failOn map[string]error) (reloaded []string) {
		t.Helper()
		origList, origReload := sweepListServers, sweepReloadConfig
		sweepListServers = func(context.Context) ([]string, error) { return servers, listErr }
		sweepReloadConfig = func(server string) error {
			reloaded = append(reloaded, server)
			return failOn[server]
		}
		t.Cleanup(func() { sweepListServers, sweepReloadConfig = origList, origReload })
		return nil
	}

	t.Run("only live-enumerated servers are reloaded", func(t *testing.T) {
		var reloaded []string
		origList, origReload := sweepListServers, sweepReloadConfig
		sweepListServers = func(context.Context) ([]string, error) { return []string{"a", "b"}, nil }
		sweepReloadConfig = func(server string) error {
			reloaded = append(reloaded, server)
			return nil
		}
		t.Cleanup(func() { sweepListServers, sweepReloadConfig = origList, origReload })

		RefreshSweep(context.Background())
		if strings.Join(reloaded, ",") != "a,b" {
			t.Errorf("reloaded = %v, want exactly [a b] — dead sockets must never be touched", reloaded)
		}
	})

	t.Run("a per-server error does not abort the sweep", func(t *testing.T) {
		var reloaded []string
		origList, origReload := sweepListServers, sweepReloadConfig
		sweepListServers = func(context.Context) ([]string, error) { return []string{"a", "b"}, nil }
		sweepReloadConfig = func(server string) error {
			reloaded = append(reloaded, server)
			if server == "a" {
				return fmt.Errorf("boom")
			}
			return nil
		}
		t.Cleanup(func() { sweepListServers, sweepReloadConfig = origList, origReload })

		RefreshSweep(context.Background())
		if strings.Join(reloaded, ",") != "a,b" {
			t.Errorf("reloaded = %v, want [a b] — a's failure must not prevent b", reloaded)
		}
	})

	t.Run("enumeration error reloads nothing", func(t *testing.T) {
		reloaded := stub(t, nil, fmt.Errorf("socket dir unreadable"), nil)
		RefreshSweep(context.Background())
		if len(reloaded) != 0 {
			t.Errorf("reloaded = %v, want none on enumeration failure", reloaded)
		}
	})
}
