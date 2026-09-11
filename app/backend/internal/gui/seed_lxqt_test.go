package gui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withLXQtRoots points the probe seams at fixtures for one test.
func withLXQtRoots(t *testing.T, iconRoot string, appDirs []string) {
	t.Helper()
	origRoot, origDirs := lxqtIconThemeRoot, lxqtApplicationsDirs
	t.Cleanup(func() { lxqtIconThemeRoot, lxqtApplicationsDirs = origRoot, origDirs })
	lxqtIconThemeRoot = iconRoot
	lxqtApplicationsDirs = appDirs
}

func TestLXQtConfigDirsEnv(t *testing.T) {
	if got, want := LXQtConfigDirsEnv("/s/lxqt/etc", ""), "XDG_CONFIG_DIRS=/s/lxqt/etc:/etc/xdg"; got != want {
		t.Errorf("LXQtConfigDirsEnv(empty inherited) = %q, want %q", got, want)
	}
	if got, want := LXQtConfigDirsEnv("/s/lxqt/etc", "/a:/b"), "XDG_CONFIG_DIRS=/s/lxqt/etc:/a:/b"; got != want {
		t.Errorf("LXQtConfigDirsEnv(inherited) = %q, want %q", got, want)
	}
}

func TestLXQtDefaultsDirUnderStateDir(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	state, err := StateDir()
	if err != nil {
		t.Fatal(err)
	}
	dir, err := LXQtDefaultsDir()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(state, "lxqt", "etc"); dir != want {
		t.Errorf("LXQtDefaultsDir() = %q, want %q", dir, want)
	}
}

func TestSeedLXQtFirstSeed(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "etc")
	withLXQtRoots(t, t.TempDir(), []string{t.TempDir()})

	seeded, err := SeedLXQtDefaults(dir, LaunchResolution{})
	if err != nil {
		t.Fatalf("SeedLXQtDefaults: %v", err)
	}
	if !seeded {
		t.Error("seeded = false on the first call, want true")
	}

	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("Stat dir: %v", err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Errorf("dir mode = %o, want 700", info.Mode().Perm())
	}
	for _, rel := range lxqtSeedFiles {
		path := filepath.Join(dir, filepath.FromSlash(rel))
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("Stat %s: %v", rel, err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("%s mode = %o, want 600", rel, info.Mode().Perm())
		}
		if sub, err := os.Stat(filepath.Dir(path)); err != nil {
			t.Errorf("%s parent: %v", rel, err)
		} else if sub.Mode().Perm() != 0o700 {
			t.Errorf("%s parent mode = %o, want 700", rel, sub.Mode().Perm())
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		want, err := lxqtSeedFS.ReadFile("seed/lxqt/" + rel)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("%s = %q, want the embedded seed verbatim (empty icon root, no launcher roles)", rel, got)
		}
	}
	panel, err := os.ReadFile(filepath.Join(dir, "lxqt", "panel.conf"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(panel), `apps\size=0`) {
		t.Errorf("panel.conf = %q, want apps\\size=0 with no resolved roles", panel)
	}
	lxqtConf, err := os.ReadFile(filepath.Join(dir, "lxqt", "lxqt.conf"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(lxqtConf), "icon_theme=") {
		t.Errorf("lxqt.conf = %q, want no icon_theme line when no theme is installed", lxqtConf)
	}
	for _, banned := range []string{"timeShowSeconds", "WallpaperMode=color", "powermanagement", "locker"} {
		for _, rel := range lxqtSeedFiles {
			data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), banned) {
				t.Errorf("%s contains %q, want it absent (the verdict's corrections)", rel, banned)
			}
		}
	}
}

func TestSeedLXQtIconThemeProbed(t *testing.T) {
	for name, tc := range map[string]struct {
		installed []string
		want      string
	}{
		"first hit wins":  {[]string{"Adwaita", "Papirus-Dark", "breeze-dark"}, "breeze-dark"},
		"middle rung":     {[]string{"Adwaita", "Papirus-Dark"}, "Papirus-Dark"},
		"last rung":       {[]string{"Adwaita"}, "Adwaita"},
		"file not a dir":  {nil, ""},
		"nothing present": {nil, ""},
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			for _, theme := range tc.installed {
				if err := os.MkdirAll(filepath.Join(root, theme), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			if name == "file not a dir" {
				if err := os.WriteFile(filepath.Join(root, "Adwaita"), []byte("not a dir"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			withLXQtRoots(t, root, []string{t.TempDir()})
			dir := filepath.Join(t.TempDir(), "etc")
			if _, err := SeedLXQtDefaults(dir, LaunchResolution{}); err != nil {
				t.Fatalf("SeedLXQtDefaults: %v", err)
			}
			data, err := os.ReadFile(filepath.Join(dir, "lxqt", "lxqt.conf"))
			if err != nil {
				t.Fatal(err)
			}
			if tc.want == "" {
				if strings.Contains(string(data), "icon_theme=") {
					t.Errorf("lxqt.conf = %q, want no icon_theme line", data)
				}
				if !strings.Contains(string(data), "theme=dark") {
					t.Errorf("lxqt.conf = %q, want theme=dark kept", data)
				}
				return
			}
			if !strings.Contains(string(data), "theme=dark\nicon_theme="+tc.want+"\n") {
				t.Errorf("lxqt.conf = %q, want icon_theme=%s after theme=dark", data, tc.want)
			}
		})
	}
}

// fakeLXQtBin builds a fake bin root: a real qterminal binary plus an
// x-terminal-emulator symlink onto it (the Debian-alternative shape).
func fakeLXQtBin(t *testing.T) string {
	t.Helper()
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "qterminal"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "chromium"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("qterminal", filepath.Join(bin, "x-terminal-emulator")); err != nil {
		t.Fatal(err)
	}
	return bin
}

func TestSeedLXQtQuicklaunchDesktopPath(t *testing.T) {
	bin := fakeLXQtBin(t)
	apps := t.TempDir()
	if err := os.WriteFile(filepath.Join(apps, "qterminal.desktop"), []byte("[Desktop Entry]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	withLXQtRoots(t, t.TempDir(), []string{apps})
	dir := filepath.Join(t.TempDir(), "etc")

	if _, err := SeedLXQtDefaults(dir, LaunchResolution{
		Terminal: LaunchApp{Name: "x-terminal-emulator", Path: filepath.Join(bin, "x-terminal-emulator")},
	}); err != nil {
		t.Fatalf("SeedLXQtDefaults: %v", err)
	}
	panel, err := os.ReadFile(filepath.Join(dir, "lxqt", "panel.conf"))
	if err != nil {
		t.Fatal(err)
	}
	want := `apps\size=1` + "\n" + `apps\1\desktop=` + filepath.Join(apps, "qterminal.desktop")
	if !strings.Contains(string(panel), want) {
		t.Errorf("panel.conf = %q, want %q (the symlink-resolved basename's desktop file; no browser entry)", panel, want)
	}
	if strings.Contains(string(panel), "Browser") || strings.Contains(string(panel), `apps\2\`) {
		t.Errorf("panel.conf = %q, want no browser entry for an unresolved role", panel)
	}
}

func TestSeedLXQtQuicklaunchLadderNameFallback(t *testing.T) {
	bin := fakeLXQtBin(t)
	apps := t.TempDir()
	// The desktop file matches the ladder name, not the resolved basename.
	if err := os.WriteFile(filepath.Join(apps, "x-terminal-emulator.desktop"), []byte("[Desktop Entry]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	withLXQtRoots(t, t.TempDir(), []string{apps})
	dir := filepath.Join(t.TempDir(), "etc")

	if _, err := SeedLXQtDefaults(dir, LaunchResolution{
		Terminal: LaunchApp{Name: "x-terminal-emulator", Path: filepath.Join(bin, "x-terminal-emulator")},
	}); err != nil {
		t.Fatalf("SeedLXQtDefaults: %v", err)
	}
	panel, err := os.ReadFile(filepath.Join(dir, "lxqt", "panel.conf"))
	if err != nil {
		t.Fatal(err)
	}
	want := `apps\1\desktop=` + filepath.Join(apps, "x-terminal-emulator.desktop")
	if !strings.Contains(string(panel), want) {
		t.Errorf("panel.conf = %q, want %q (the ladder name tried after the resolved basename)", panel, want)
	}
}

func TestSeedLXQtQuicklaunchExecFallback(t *testing.T) {
	bin := fakeLXQtBin(t)
	withLXQtRoots(t, t.TempDir(), []string{t.TempDir()})
	dir := filepath.Join(t.TempDir(), "etc")

	if _, err := SeedLXQtDefaults(dir, LaunchResolution{
		Browser: LaunchApp{Name: "chromium", Path: filepath.Join(bin, "chromium")},
	}); err != nil {
		t.Fatalf("SeedLXQtDefaults: %v", err)
	}
	panel, err := os.ReadFile(filepath.Join(dir, "lxqt", "panel.conf"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`apps\size=1`, `apps\1\name=Browser`, `apps\1\exec=chromium`, `apps\1\icon=web-browser`} {
		if !strings.Contains(string(panel), want) {
			t.Errorf("panel.conf = %q, want %q (the name/exec/icon fallback for a resolved binary with no desktop file)", panel, want)
		}
	}
}

func TestSeedLXQtUserEditSurvives(t *testing.T) {
	withLXQtRoots(t, t.TempDir(), []string{t.TempDir()})
	dir := filepath.Join(t.TempDir(), "etc")
	if _, err := SeedLXQtDefaults(dir, LaunchResolution{}); err != nil {
		t.Fatalf("first seed: %v", err)
	}
	edits := map[string][]byte{
		"lxqt/session.conf": []byte("[General]\nwindow_manager=xfwm4\n"),
		"lxqt/lxqt.conf":    []byte("[General]\ntheme=frost\nicon_theme=user-pick\n"),
	}
	for rel, content := range edits {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(rel)), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	seeded, err := SeedLXQtDefaults(dir, LaunchResolution{
		Terminal: LaunchApp{Name: "xterm", Path: "/usr/bin/xterm"},
	})
	if err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if seeded {
		t.Error("seeded = true over user-edited files, want false (write-once)")
	}
	for rel, want := range edits {
		got, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("%s = %q, want the user edit byte-identical", rel, got)
		}
	}
}

func TestSeedLXQtPanelEditSurvivesQuicklaunchTracks(t *testing.T) {
	bin := fakeLXQtBin(t)
	withLXQtRoots(t, t.TempDir(), []string{t.TempDir()})
	dir := filepath.Join(t.TempDir(), "etc")
	if _, err := SeedLXQtDefaults(dir, LaunchResolution{
		Terminal: LaunchApp{Name: "x-terminal-emulator", Path: filepath.Join(bin, "x-terminal-emulator")},
	}); err != nil {
		t.Fatalf("first seed: %v", err)
	}
	panelPath := filepath.Join(dir, "lxqt", "panel.conf")
	data, err := os.ReadFile(panelPath)
	if err != nil {
		t.Fatal(err)
	}
	edited := strings.Replace(string(data), "panelSize=32", "panelSize=40", 1)
	if err := os.WriteFile(panelPath, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}

	seeded, err := SeedLXQtDefaults(dir, LaunchResolution{
		Terminal: LaunchApp{Name: "x-terminal-emulator", Path: filepath.Join(bin, "x-terminal-emulator")},
		Browser:  LaunchApp{Name: "chromium", Path: filepath.Join(bin, "chromium")},
	})
	if err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if seeded {
		t.Error("seeded = true with every file present, want false (the quick-launch rewrite is not a seed)")
	}
	got, err := os.ReadFile(panelPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "panelSize=40") {
		t.Errorf("panel.conf = %q, want the hand-edited panelSize kept", got)
	}
	for _, want := range []string{`apps\size=2`, `apps\1\exec=x-terminal-emulator`, `apps\2\exec=chromium`, `apps\2\icon=web-browser`} {
		if !strings.Contains(string(got), want) {
			t.Errorf("panel.conf = %q, want %q (quick-launch tracks the newly resolved browser)", got, want)
		}
	}
	// Every non-apps line of the hand edit survives byte-identical.
	for _, line := range strings.Split(edited, "\n") {
		if strings.HasPrefix(line, `apps\`) || line == "" {
			continue
		}
		if !strings.Contains(string(got), line) {
			t.Errorf("panel.conf = %q, want the untouched line %q preserved", got, line)
		}
	}
}

func TestSeedLXQtRemovedQuicklaunchSectionUntouched(t *testing.T) {
	withLXQtRoots(t, t.TempDir(), []string{t.TempDir()})
	dir := filepath.Join(t.TempDir(), "etc")
	if _, err := SeedLXQtDefaults(dir, LaunchResolution{}); err != nil {
		t.Fatalf("first seed: %v", err)
	}
	panelPath := filepath.Join(dir, "lxqt", "panel.conf")
	edited := []byte("[General]\npanels=panel1\n[panel1]\nplugins=mainmenu,taskbar\n")
	if err := os.WriteFile(panelPath, edited, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := SeedLXQtDefaults(dir, LaunchResolution{
		Terminal: LaunchApp{Name: "xterm", Path: "/usr/bin/xterm"},
	}); err != nil {
		t.Fatalf("second seed: %v", err)
	}
	got, err := os.ReadFile(panelPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(edited) {
		t.Errorf("panel.conf = %q, want the quicklaunch-less file untouched", got)
	}
}

func TestSeedLXQtDeleteOneFileReseeds(t *testing.T) {
	withLXQtRoots(t, t.TempDir(), []string{t.TempDir()})
	dir := filepath.Join(t.TempDir(), "etc")
	if _, err := SeedLXQtDefaults(dir, LaunchResolution{}); err != nil {
		t.Fatalf("first seed: %v", err)
	}
	before := map[string][]byte{}
	for _, rel := range lxqtSeedFiles {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		before[rel] = data
	}
	if err := os.Remove(filepath.Join(dir, "lxqt", "lxqt.conf")); err != nil {
		t.Fatal(err)
	}

	seeded, err := SeedLXQtDefaults(dir, LaunchResolution{})
	if err != nil {
		t.Fatalf("re-seed: %v", err)
	}
	if !seeded {
		t.Error("seeded = false after deleting lxqt.conf, want true")
	}
	for rel, want := range before {
		got, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("%s changed across the one-file re-seed, want byte-identical", rel)
		}
	}
}

func TestSeedLXQtNormalizesLooseModes(t *testing.T) {
	withLXQtRoots(t, t.TempDir(), []string{t.TempDir()})
	dir := filepath.Join(t.TempDir(), "etc")
	for _, rel := range lxqtSeedFiles {
		path := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("user content\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	seeded, err := SeedLXQtDefaults(dir, LaunchResolution{})
	if err != nil {
		t.Fatalf("SeedLXQtDefaults: %v", err)
	}
	if seeded {
		t.Error("seeded = true with every file present, want false")
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Errorf("dir mode = %o, want 700", info.Mode().Perm())
	}
	for _, rel := range lxqtSeedFiles {
		path := filepath.Join(dir, filepath.FromSlash(rel))
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("%s mode = %o, want 600", rel, info.Mode().Perm())
		}
		if sub, err := os.Stat(filepath.Dir(path)); err != nil {
			t.Errorf("%s parent: %v", rel, err)
		} else if sub.Mode().Perm() != 0o700 {
			t.Errorf("%s parent mode = %o, want 700", rel, sub.Mode().Perm())
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if rel != "lxqt/panel.conf" && string(data) != "user content\n" {
			t.Errorf("%s rewritten to %q, want the user's content kept", rel, data)
		}
	}
}
