package gui

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"syscall"
)

// AppRole is one allowlisted launcher role — the HTTP body and the CLI
// argument carry a role, never argv (no arbitrary command over the API).
type AppRole string

const (
	AppTerminal AppRole = "terminal"
	AppBrowser  AppRole = "browser"
)

// ParseAppRole accepts exactly "terminal" | "browser"; anything else is a
// usage-class error naming both.
func ParseAppRole(s string) (AppRole, error) {
	switch AppRole(s) {
	case AppTerminal:
		return AppTerminal, nil
	case AppBrowser:
		return AppBrowser, nil
	}
	return "", errors.New("app must be terminal or browser")
}

// appLadders is the fixed per-role probe order — first fully-resolved entry
// wins. Shared by the CLI verb, the HTTP endpoint, and the seeded IceWM
// toolbar/menu rows so every surface agrees on which binary "the terminal" is.
var appLadders = map[AppRole][]string{
	AppTerminal: {"x-terminal-emulator", "xterm", "uxterm", "lxterm", "foot", "alacritty", "kitty", "gnome-terminal", "xfce4-terminal"},
	AppBrowser:  {"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "firefox", "x-www-browser"},
}

// ResolveApp returns the first ladder entry for role that lookPath resolves
// AND whose resolved path stat succeeds — a Debian alternative
// (/usr/bin/x-www-browser → /etc/alternatives/x-www-browser → <missing>) can
// be a dangling symlink; the stat follows it. name is the ladder entry
// (argv[0] for the toolbar rows), path the resolved binary. ok=false when the
// whole ladder misses.
func ResolveApp(role AppRole, lookPath func(string) (string, error), stat func(string) (os.FileInfo, error)) (name, path string, ok bool) {
	for _, entry := range appLadders[role] {
		p, err := lookPath(entry)
		if err != nil {
			continue
		}
		if _, err := stat(p); err != nil {
			continue
		}
		return entry, p, true
	}
	return "", "", false
}

// LaunchHint is the per-manager missing-app line — wording only, rk never
// runs the command (the install-composition standard: probe, degrade, hint).
func LaunchHint(role AppRole, lookPath func(string) (string, error)) string {
	var noun, pkg string
	switch role {
	case AppBrowser:
		noun = "browser"
		pkg = "chromium"
	case AppTerminal:
		noun = "terminal"
		pkg = "xterm"
	default:
		return ""
	}
	prefix := "no " + noun + " on the GUI host — "
	switch PackageManager(lookPath) {
	case "apt":
		if role == AppBrowser {
			pkg = "chromium-browser"
		}
		return prefix + "sudo apt install " + pkg
	case "dnf":
		return prefix + "sudo dnf install " + pkg
	case "pacman":
		return prefix + "sudo pacman -S " + pkg
	}
	return prefix + "install a " + noun + " with your package manager"
}

// LaunchEnv composes the launched app's environment: base with DISPLAY and
// RK_GUI_SOCKET set — existing entries are replaced, never duplicated (the rk
// display is the point of the launch).
func LaunchEnv(base []string, display, socket string) []string {
	env := make([]string, 0, len(base)+2)
	seenDisplay, seenSocket := false, false
	for _, kv := range base {
		switch {
		case strings.HasPrefix(kv, "DISPLAY="):
			if !seenDisplay {
				env = append(env, "DISPLAY="+display)
				seenDisplay = true
			}
		case strings.HasPrefix(kv, "RK_GUI_SOCKET="):
			if !seenSocket {
				env = append(env, "RK_GUI_SOCKET="+socket)
				seenSocket = true
			}
		default:
			env = append(env, kv)
		}
	}
	if !seenDisplay {
		env = append(env, "DISPLAY="+display)
	}
	if !seenSocket {
		env = append(env, "RK_GUI_SOCKET="+socket)
	}
	return env
}

// StartDetached starts argv as its own session (Setsid — it outlives the
// caller's shell) with stdio on /dev/null and returns the pid immediately:
// nil stdio streams read/write /dev/null, so a long-lived GUI app cannot hang
// the caller on a pipe it never closes. Constitution §I's timeout rule
// governs subprocesses rk waits on; nothing here blocks on the child. Setsid
// detaches the session, not the parent/child link, so the child is reaped
// asynchronously — otherwise every terminal or browser that later exits
// would linger as a zombie under the long-lived daemon.
func StartDetached(argv, env []string) (pid int, err error) {
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	go func() { _ = cmd.Wait() }()
	return cmd.Process.Pid, nil
}
