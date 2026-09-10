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

// dePackages is one desktop environment's install wording per package
// manager. Wording only — rk never executes a package manager
// (install-composition: probe, degrade, hint).
type dePackages struct {
	apt, dnf, pacman, generic string
}

// lxqtPackages / xfce4Packages are the per-manager install lines for the two
// supported full desktops. dnf names the explicit package list, never the
// @lxqt-desktop group. Non-apt package names are best-effort wording.
var (
	lxqtPackages = dePackages{
		apt:     "sudo apt install --no-install-recommends lxqt-core",
		dnf:     "sudo dnf install lxqt-session lxqt-panel lxqt-config pcmanfm-qt qterminal",
		pacman:  "sudo pacman -S lxqt",
		generic: "install lxqt with your package manager",
	}
	xfce4Packages = dePackages{
		apt:     "sudo apt install --no-install-recommends xfce4",
		dnf:     "sudo dnf install xfce4-session xfce4-panel xfce4-settings xfdesktop xfce4-terminal",
		pacman:  "sudo pacman -S xfce4",
		generic: "install xfce4 with your package manager",
	}
)

// sessionStarterDEs maps the session-starter binaries with a known packaging
// line to their desktop's package set. Starters without an entry
// (startplasma-x11, x-session-manager) have no DE hint.
var sessionStarterDEs = map[string]dePackages{
	"startlxqt":     lxqtPackages,
	"lxqt-session":  lxqtPackages,
	"startxfce4":    xfce4Packages,
	"xfce4-session": xfce4Packages,
}

// DEInstallHint is the install line for a session-starter binary name,
// package-manager-aware like WMInstallHint; "" for any other name and off
// Linux (no desktop session runs there), so callers can fall back.
func DEInstallHint(name string, lookPath func(string) (string, error)) string {
	if goos != "linux" {
		return ""
	}
	pkgs, ok := sessionStarterDEs[name]
	if !ok {
		return ""
	}
	switch PackageManager(lookPath) {
	case "apt":
		return pkgs.apt
	case "dnf":
		return pkgs.dnf
	case "pacman":
		return pkgs.pacman
	}
	return pkgs.generic
}

// PinInstallHint is the one install line a gui.wm pin-miss names: the DE line
// when the pin is a session starter with known packaging, the bare-WM line
// otherwise. The wm verb's PATH refusal and the supervisor's pin-miss log
// line share it so both word a refusal identically.
func PinInstallHint(name string, lookPath func(string) (string, error)) string {
	if hint := DEInstallHint(name, lookPath); hint != "" {
		return hint
	}
	return WMInstallHint(lookPath)
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
