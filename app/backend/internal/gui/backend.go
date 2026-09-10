package gui

import (
	"runtime"
)

// goos is the platform fork seam (backend detection and install hints differ
// per OS). A package var so tests exercise the non-host branches.
var goos = runtime.GOOS

// MacBackend is the stamped backend name on darwin — Screen Sharing is the
// substrate; nothing is spawned.
const MacBackend = "screen-sharing"

// MacScreenSharingAddr is the loopback VNC endpoint macOS Screen Sharing
// serves when enabled — the relay's dial target and the darwin supervisor's
// probe target share it so the two cannot drift.
const MacScreenSharingAddr = "127.0.0.1:5900"

// ResolveBackend resolves the GUI backend for the current OS. darwin has no
// spawned backend — Screen Sharing is the substrate. Linux resolves by name:
// Xtigervnc first, Xvnc only when Xtigervnc is absent (the KasmVNC deb hijacks
// the Xvnc name via update-alternatives), "" when neither is installed.
func ResolveBackend(lookPath func(string) (string, error)) (name, path string) {
	if goos == "darwin" {
		return MacBackend, ""
	}
	if p, err := lookPath("Xtigervnc"); err == nil {
		return "Xtigervnc", p
	}
	if p, err := lookPath("Xvnc"); err == nil {
		return "Xvnc", p
	}
	return "", ""
}

// BackendAddr returns the OS-appropriate backend endpoint for the RFB probe
// and the WS relay: the unix socket under the state dir on Linux, loopback
// VNC (Screen Sharing) on macOS.
func BackendAddr(id string) (network, addr string, err error) {
	if goos == "darwin" {
		return "tcp", MacScreenSharingAddr, nil
	}
	sock, err := SocketPath(id)
	if err != nil {
		return "", "", err
	}
	return "unix", sock, nil
}

// BackendArgv builds the fixed VNC backend argv. display is the ":N" string.
// -rfbport -1 is mandatory: without it TigerVNC binds TCP 5900+N on all
// interfaces, and the unix socket must be the only door. Auth is None because
// rk on the same user is the only client.
func BackendArgv(bin, display, socket string) []string {
	return []string{
		bin, display,
		"-rfbunixpath", socket,
		"-rfbport", "-1",
		"-SecurityTypes", "None",
		"-AlwaysShared",
		"-AcceptSetDesktopSize",
		"-geometry", "1920x1080",
		"-FrameRate=60",
		"-desktop", "run-kit",
	}
}

// wmLadder is the fixed window-manager probe order: IceWM first (a taskbar,
// start menu, and clock are built in and it costs ~29 MB idle), then the
// lighter WMs, then x-session-manager (a full DE session) last.
var wmLadder = []string{"icewm-session", "openbox", "xfwm4", "i3", "kwin_x11", "x-session-manager"}

// WMLadder returns the window-manager probe order — the one place the
// supervisor's no-WM log line and tests read it from.
func WMLadder() []string {
	return append([]string(nil), wmLadder...)
}

// sessionStarters are the desktop-environment session binaries: every member
// runs under dbus-run-session (a DE without a session bus fails its panel,
// tray, and policy agents silently — libdbus autolaunch on a headless X
// display is not dependable). Bare window managers stay unwrapped.
var sessionStarters = map[string]bool{
	"startlxqt": true, "lxqt-session": true,
	"startxfce4": true, "xfce4-session": true,
	"startplasma-x11": true, "x-session-manager": true,
}

// IsSessionStarter reports whether name is a session-starter binary — the
// status summary's (session) suffix, the supervisor's WM line, and desktop
// candidate labeling share this one table.
func IsSessionStarter(name string) bool {
	return sessionStarters[name]
}

// WMOwnsProcessGroup reports whether a launch argv must run in — and be
// stopped via — its own process group: true exactly for a session starter.
// Under the dbus-run-session wrap the direct child is the wrapper; signalling
// it alone reparents dbus-daemon and every session module to PID 1, so launch
// and teardown must target the group. The policy lives beside the wrap rule;
// the supervisor is a consumer.
func WMOwnsProcessGroup(argv []string) bool {
	return IsSessionStarter(WMName(argv))
}

// WMArgv returns the launch argv for one window-manager binary name:
// icewm-session runs --nobg --notray (icewmbg would paint a theme wallpaper
// over rk's xsetroot ground; the tray is dead weight on a single-user
// display), every session starter runs under dbus-run-session, anything else
// runs bare. The flags belong to the binary, not to how it was chosen — a
// pinned name gets the same argv as its ladder rung.
func WMArgv(name string) []string {
	if sessionStarters[name] {
		return []string{"dbus-run-session", "--", name}
	}
	if name == "icewm-session" {
		return []string{"icewm-session", "--nobg", "--notray"}
	}
	return []string{name}
}

// WMName recovers the window-manager binary name from a launch argv: the
// dbus-run-session wrap's target for a session starter, argv[0] otherwise.
// Stamps and log lines name the WM, never the wrapper.
func WMName(argv []string) string {
	if len(argv) == 0 {
		return ""
	}
	if len(argv) == 3 && argv[0] == "dbus-run-session" && argv[1] == "--" {
		return argv[2]
	}
	return argv[0]
}

// ResolveWM picks the window manager: the pin (gui.wm) when non-empty and on
// PATH, else the first ladder rung on PATH. pinMissed reports a non-empty pin
// that did not resolve (the caller logs the fallback line); ok=false means
// nothing resolved and the display runs bare — still usable.
func ResolveWM(lookPath func(string) (string, error), pin string) (argv []string, pinMissed, ok bool) {
	if pin != "" {
		if _, err := lookPath(pin); err == nil {
			return WMArgv(pin), false, true
		}
		pinMissed = true
	}
	for _, wm := range wmLadder {
		if _, err := lookPath(wm); err != nil {
			continue
		}
		return WMArgv(wm), pinMissed, true
	}
	return nil, pinMissed, false
}

// RootBackground is the solid color painted onto the X root window once the
// WM is up. Xvnc's default root is black and openbox paints no desktop, so an
// empty desktop would otherwise be indistinguishable from a dead canvas. A
// solid fill costs the encoder one rect per update; the classic X weave
// stipple (-retro) would be JPEG noise on every full update.
const RootBackground = "#3b4252"

// RootBackgroundArgv returns the argv that paints the root window, or ok=false
// when xsetroot is not on PATH (the desktop stays black and the supervisor
// logs the install hint).
func RootBackgroundArgv(lookPath func(string) (string, error)) (argv []string, ok bool) {
	if _, err := lookPath("xsetroot"); err != nil {
		return nil, false
	}
	return []string{"xsetroot", "-solid", RootBackground}, true
}
