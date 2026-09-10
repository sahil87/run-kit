package gui

// packageManagerProbes maps a manager name to the binary whose presence on
// PATH detects it, probed in slice order (first found wins). Detection is by
// binary presence only — rk never executes a package manager; the hints are
// wording (the install-composition standard: probe, degrade, hint).
var packageManagerProbes = []struct {
	binary string
	name   string
}{
	{"apt-get", "apt"},
	{"dnf", "dnf"},
	{"pacman", "pacman"},
}

// PackageManager reports "apt" | "dnf" | "pacman" | "" by probing apt-get,
// dnf, pacman on PATH in that order. lookPath is exec.LookPath, injected so
// tests exercise every branch without depending on the host PATH; a nil
// lookPath (StatusDeps promises nil seams are safe) detects nothing.
func PackageManager(lookPath func(string) (string, error)) string {
	if lookPath == nil {
		return ""
	}
	for _, pm := range packageManagerProbes {
		if _, err := lookPath(pm.binary); err == nil {
			return pm.name
		}
	}
	return ""
}

// WMInstallHint is the one-line install command for the window manager,
// worded for the detected package manager; with no manager detected it
// degrades to a generic sentence. Only Linux runs a window manager (the
// darwin supervisor mirrors Screen Sharing and starts none), so every other
// OS gets no hint — callers omit the segment when it is empty.
func WMInstallHint(lookPath func(string) (string, error)) string {
	if goos != "linux" {
		return ""
	}
	switch PackageManager(lookPath) {
	case "apt":
		return "sudo apt install --no-install-recommends icewm"
	case "dnf":
		return "sudo dnf install icewm"
	case "pacman":
		return "sudo pacman -S icewm"
	}
	return "install icewm with your package manager"
}

// InstallHint is the per-OS remediation line for a missing GUI backend —
// Linux needs a VNC X server and a window manager (worded for the detected
// package manager), macOS needs Screen Sharing enabled. Other OSes have no
// supported backend and get no hint. The Linux line starts at the install
// command: callers supply their own prefix.
func InstallHint(lookPath func(string) (string, error)) string {
	switch goos {
	case "linux":
		switch PackageManager(lookPath) {
		case "apt":
			return "sudo apt install --no-install-recommends tigervnc-standalone-server icewm"
		case "dnf":
			return "sudo dnf install tigervnc-server icewm"
		case "pacman":
			return "sudo pacman -S tigervnc icewm"
		}
		return "install a VNC X server (TigerVNC) and icewm with your package manager"
	case "darwin":
		return "enable System Settings › General › Sharing › Screen Sharing"
	default:
		return ""
	}
}
