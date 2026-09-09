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

// wmLadder is the fixed window-manager probe order. x-session-manager (a full
// DE session) must run under dbus-run-session.
var wmLadder = []string{"openbox", "xfwm4", "i3", "kwin_x11", "x-session-manager"}

// ResolveWM returns the argv for the first window manager on the ladder that
// lookPath resolves, or ok=false when none is installed (the display runs
// bare — still usable).
func ResolveWM(lookPath func(string) (string, error)) (argv []string, ok bool) {
	for _, wm := range wmLadder {
		if _, err := lookPath(wm); err != nil {
			continue
		}
		if wm == "x-session-manager" {
			return []string{"dbus-run-session", "--", wm}, true
		}
		return []string{wm}, true
	}
	return nil, false
}
