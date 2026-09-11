package gui

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// lxqtSeedFS is the seeded LXQt defaults tree (verified on LXQt 0.17.1):
// session.conf pins openbox and drops the power/locker prompts, panel.conf is
// one bottom panel with a minutes-only clock, lxqt.conf picks the dark theme
// (icon_theme is probed at seed time, not embedded), pcmanfm-qt's settings
// paint the solid #3b4252 desktop with no icons, and the autostart entry
// shadows the system xscreensaver one with Hidden=true.
//
//go:embed seed/lxqt
var lxqtSeedFS embed.FS

// lxqtSeedFiles lists the seed tree's files relative to seed/lxqt.
var lxqtSeedFiles = []string{
	"lxqt/session.conf",
	"lxqt/panel.conf",
	"lxqt/lxqt.conf",
	"pcmanfm-qt/lxqt/settings.conf",
	"autostart/lxqt-xscreensaver-autostart.desktop",
}

// Probe roots are host facts, not caller decisions — package-var seams (the
// guiSuperviseLookPath idiom) so tests point them at fixtures.
var (
	// lxqtIconThemeRoot is the icon-theme root the lxqt.conf probe reads.
	lxqtIconThemeRoot = "/usr/share/icons"
	// lxqtApplicationsDirs are the XDG applications roots the quick-launch
	// .desktop lookup walks, in order.
	lxqtApplicationsDirs = []string{"/usr/share/applications", "/usr/local/share/applications"}
	// lxqtEvalSymlinks resolves a binary's symlink chain (a Debian
	// alternative like x-terminal-emulator has no desktop file of its own —
	// the resolved target's basename is the reliable lookup key).
	lxqtEvalSymlinks = filepath.EvalSymlinks
)

// LaunchApp is one resolved launcher role: the ladder name and the resolved
// binary path, as gui.ResolveApp returns them.
type LaunchApp struct {
	Name, Path string
}

// LaunchResolution carries the terminal and browser resolutions the seeded
// panel's quick-launch entries are rendered from.
type LaunchResolution struct {
	Terminal, Browser LaunchApp
}

// LXQtDefaultsDir is the directory prepended to XDG_CONFIG_DIRS for an LXQt
// session: <StateDir>/lxqt/etc — the same string is the seed root, the env
// prefix, and the logged path (one path for the delete-to-re-seed rule).
func LXQtDefaultsDir() (string, error) {
	dir, err := StateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "lxqt", "etc"), nil
}

// LXQtConfigDirsEnv composes the XDG_CONFIG_DIRS entry for the session
// starter's env: the defaults dir first, then the inherited value — an empty
// inherited value behaves as unset (the XDG default /etc/xdg).
func LXQtConfigDirsEnv(dir, inherited string) string {
	if inherited == "" {
		inherited = "/etc/xdg"
	}
	return "XDG_CONFIG_DIRS=" + dir + ":" + inherited
}

// SeedLXQtDefaults writes the five seed files under dir (the directory later
// prepended to XDG_CONFIG_DIRS) when absent: write-once per file, so a user
// edit to any file persists across restarts and deleting one file re-seeds
// only that file. panel.conf is the exception in one section: its
// [quicklaunch] apps\* keys are rewritten in place on every call from the
// current launcher resolution (.desktop paths for resolved roles, a
// name=/exec=/icon= triple when the resolved binary has no desktop file,
// nothing for an unresolved role), while every other line — a user's
// panelSize edit included — survives; a removed [quicklaunch] section is not
// re-added. lxqt.conf's icon_theme is probed from the icon-theme root at seed
// time (breeze-dark, then Papirus-Dark, then Adwaita; the key is omitted when
// none is installed — lxqt-core ships none, and the panel's text-label
// fallback is an acceptable degrade). Directory tree 0700, files 0600,
// normalized on every call (the SeedProfile rule). seeded reports whether any
// file was newly written on this call — the supervisor's log line names the
// first seed.
func SeedLXQtDefaults(dir string, apps LaunchResolution) (seeded bool, err error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, fmt.Errorf("creating the LXQt defaults dir: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return false, fmt.Errorf("securing the LXQt defaults dir: %w", err)
	}
	for _, rel := range lxqtSeedFiles {
		written, err := seedLXQtFile(dir, rel, apps)
		if err != nil {
			return false, err
		}
		seeded = seeded || written
	}
	return seeded, nil
}

// seedLXQtFile handles one seed file: written when absent (panel.conf's
// quick-launch and lxqt.conf's icon theme rendered at write time), the
// quick-launch rewrite applied to a pre-existing panel.conf, modes normalized
// either way.
func seedLXQtFile(dir, rel string, apps LaunchResolution) (written bool, err error) {
	path := filepath.Join(dir, filepath.FromSlash(rel))
	sub := filepath.Dir(path)
	if err := os.MkdirAll(sub, 0o700); err != nil {
		return false, fmt.Errorf("creating %s: %w", sub, err)
	}
	if err := os.Chmod(sub, 0o700); err != nil {
		return false, fmt.Errorf("securing %s: %w", sub, err)
	}
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		content, err := lxqtSeedContent(rel)
		if err != nil {
			return false, err
		}
		if rel == "lxqt/panel.conf" {
			content = lxqtQuicklaunchRewrite(content, apps)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			return false, fmt.Errorf("seeding %s: %w", rel, err)
		}
		return true, nil
	} else if err != nil {
		return false, fmt.Errorf("reading %s: %w", rel, err)
	}
	if rel == "lxqt/panel.conf" {
		data, err := os.ReadFile(path)
		if err != nil {
			return false, fmt.Errorf("reading %s: %w", rel, err)
		}
		if rewritten := lxqtQuicklaunchRewrite(string(data), apps); rewritten != string(data) {
			if err := os.WriteFile(path, []byte(rewritten), 0o600); err != nil {
				return false, fmt.Errorf("regenerating %s quick-launch: %w", rel, err)
			}
		}
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return false, fmt.Errorf("securing %s: %w", rel, err)
	}
	return false, nil
}

// lxqtSeedContent reads one embedded seed file; lxqt.conf gains the probed
// icon theme (no line at all when no known theme is installed).
func lxqtSeedContent(rel string) (string, error) {
	data, err := lxqtSeedFS.ReadFile("seed/lxqt/" + rel)
	if err != nil {
		return "", fmt.Errorf("reading the embedded %s: %w", rel, err)
	}
	content := string(data)
	if rel == "lxqt/lxqt.conf" {
		if theme := lxqtProbeIconTheme(); theme != "" {
			content = strings.Replace(content, "theme=dark\n", "theme=dark\nicon_theme="+theme+"\n", 1)
		}
	}
	return content, nil
}

// lxqtProbeIconTheme returns the first installed theme of the fixed dark
// ladder, "" when none is present.
func lxqtProbeIconTheme() string {
	for _, name := range []string{"breeze-dark", "Papirus-Dark", "Adwaita"} {
		if info, err := os.Stat(filepath.Join(lxqtIconThemeRoot, name)); err == nil && info.IsDir() {
			return name
		}
	}
	return ""
}

// lxqtQuicklaunchRewrite rewrites the apps\* keys of panel.conf's
// [quicklaunch] section from the current launcher resolution, preserving
// every other line byte-identically; a file without the section is returned
// unchanged.
func lxqtQuicklaunchRewrite(content string, apps LaunchResolution) string {
	lines := strings.Split(content, "\n")
	start, end := -1, len(lines)
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			if trimmed == "[quicklaunch]" {
				start = i
			} else if start >= 0 {
				end = i
				break
			}
		}
	}
	if start < 0 {
		return content
	}
	// A trailing newline's empty tail element sits outside the section.
	if end == len(lines) && lines[len(lines)-1] == "" {
		end = len(lines) - 1
	}
	out := append([]string(nil), lines[:start+1]...)
	for _, line := range lines[start+1 : end] {
		if strings.HasPrefix(line, `apps\`) {
			continue
		}
		out = append(out, line)
	}
	out = append(out, lxqtQuicklaunchEntries(apps)...)
	out = append(out, lines[end:]...)
	return strings.Join(out, "\n")
}

// lxqtQuicklaunchEntries renders the apps\* block: apps\size=N then one entry
// per resolved role in terminal→browser order. A role with a desktop file
// under an applications root gets apps\N\desktop=<path>; a resolved binary
// without one falls back to the name=/exec=/icon= triple (the binary IS
// resolved, so the entry renders); an unresolved role contributes nothing.
func lxqtQuicklaunchEntries(apps LaunchResolution) []string {
	roles := []struct {
		app  LaunchApp
		name string
		icon string
	}{
		{apps.Terminal, "Terminal", "utilities-terminal"},
		{apps.Browser, "Browser", "web-browser"},
	}
	n := 0
	var body []string
	for _, role := range roles {
		if role.app.Name == "" {
			continue
		}
		n++
		if desktop := lxqtDesktopFile(role.app); desktop != "" {
			body = append(body, fmt.Sprintf(`apps\%d\desktop=%s`, n, desktop))
			continue
		}
		body = append(body,
			fmt.Sprintf(`apps\%d\name=%s`, n, role.name),
			fmt.Sprintf(`apps\%d\exec=%s`, n, role.app.Name),
			fmt.Sprintf(`apps\%d\icon=%s`, n, role.icon),
		)
	}
	return append([]string{fmt.Sprintf(`apps\size=%d`, n)}, body...)
}

// lxqtDesktopFile returns the first existing <applications dir>/<base>.desktop
// for the role, base tried as the resolved binary's symlink-resolved basename
// then the ladder name itself; "" when no desktop file exists.
func lxqtDesktopFile(app LaunchApp) string {
	var bases []string
	if app.Path != "" {
		if resolved, err := lxqtEvalSymlinks(app.Path); err == nil {
			if base := filepath.Base(resolved); base != app.Name {
				bases = append(bases, base)
			}
		}
	}
	bases = append(bases, app.Name)
	for _, base := range bases {
		for _, dir := range lxqtApplicationsDirs {
			path := filepath.Join(dir, base+".desktop")
			if _, err := os.Stat(path); err == nil {
				return path
			}
		}
	}
	return ""
}
