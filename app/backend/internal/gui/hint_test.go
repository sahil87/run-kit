package gui

import (
	"testing"
)

func TestPackageManager(t *testing.T) {
	cases := []struct {
		name    string
		present []string
		want    string
	}{
		{"apt", []string{"apt-get"}, "apt"},
		{"dnf", []string{"dnf"}, "dnf"},
		{"pacman", []string{"pacman"}, "pacman"},
		{"none", nil, ""},
		{"apt-get wins over pacman", []string{"pacman", "apt-get"}, "apt"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := PackageManager(stubLookPath(tc.present...)); got != tc.want {
				t.Errorf("PackageManager(%v) = %q, want %q", tc.present, got, tc.want)
			}
		})
	}
}

func TestWMInstallHint(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	cases := []struct {
		name    string
		present []string
		want    string
	}{
		{"apt", []string{"apt-get"}, "sudo apt install --no-install-recommends icewm"},
		{"dnf", []string{"dnf"}, "sudo dnf install icewm"},
		{"pacman", []string{"pacman"}, "sudo pacman -S icewm"},
		{"none", nil, "install icewm with your package manager"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := WMInstallHint(stubLookPath(tc.present...)); got != tc.want {
				t.Errorf("WMInstallHint(%v) = %q, want %q", tc.present, got, tc.want)
			}
		})
	}
}

func TestInstallHint(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)

	t.Run("linux per manager", func(t *testing.T) {
		goos = "linux"
		cases := []struct {
			name    string
			present []string
			want    string
		}{
			{"apt", []string{"apt-get"}, "sudo apt install --no-install-recommends tigervnc-standalone-server icewm"},
			{"dnf", []string{"dnf"}, "sudo dnf install tigervnc-server icewm"},
			{"pacman", []string{"pacman"}, "sudo pacman -S tigervnc icewm"},
			{"none", nil, "install a VNC X server (TigerVNC) and icewm with your package manager"},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				if got := InstallHint(stubLookPath(tc.present...)); got != tc.want {
					t.Errorf("InstallHint(%v) = %q, want %q", tc.present, got, tc.want)
				}
			})
		}
	})

	t.Run("darwin is Screen Sharing", func(t *testing.T) {
		goos = "darwin"
		if got := InstallHint(stubLookPath("apt-get")); got != "enable System Settings › General › Sharing › Screen Sharing" {
			t.Errorf("darwin InstallHint() = %q", got)
		}
	})

	t.Run("unsupported OS is empty", func(t *testing.T) {
		goos = "plan9"
		if got := InstallHint(stubLookPath("apt-get")); got != "" {
			t.Errorf("unsupported OS InstallHint() = %q, want empty", got)
		}
	})
}

func TestNoBackendReason(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"

	if got, want := NoBackendReason(stubLookPath("apt-get")), "no VNC backend: sudo apt install --no-install-recommends tigervnc-standalone-server icewm"; got != want {
		t.Errorf("NoBackendReason(apt) = %q, want %q", got, want)
	}
	if got, want := NoBackendReason(stubLookPath()), "no VNC backend: install a VNC X server (TigerVNC) and icewm with your package manager"; got != want {
		t.Errorf("NoBackendReason(none) = %q, want %q", got, want)
	}
}

func TestDEInstallHint(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	cases := []struct {
		name    string
		binary  string
		present []string
		want    string
	}{
		{"lxqt apt", "startlxqt", []string{"apt-get"}, "sudo apt install --no-install-recommends lxqt-core"},
		{"lxqt dnf", "startlxqt", []string{"dnf"}, "sudo dnf install lxqt-session lxqt-panel lxqt-config pcmanfm-qt qterminal"},
		{"lxqt pacman", "startlxqt", []string{"pacman"}, "sudo pacman -S lxqt"},
		{"lxqt none", "startlxqt", nil, "install lxqt with your package manager"},
		{"lxqt-session apt", "lxqt-session", []string{"apt-get"}, "sudo apt install --no-install-recommends lxqt-core"},
		{"xfce apt", "startxfce4", []string{"apt-get"}, "sudo apt install --no-install-recommends xfce4"},
		{"xfce dnf", "startxfce4", []string{"dnf"}, "sudo dnf install xfce4-session xfce4-panel xfce4-settings xfdesktop xfce4-terminal"},
		{"xfce pacman", "startxfce4", []string{"pacman"}, "sudo pacman -S xfce4"},
		{"xfce none", "startxfce4", nil, "install xfce4 with your package manager"},
		{"xfce4-session apt", "xfce4-session", []string{"apt-get"}, "sudo apt install --no-install-recommends xfce4"},
		{"bare WM", "openbox", []string{"apt-get"}, ""},
		{"starter without packaging", "startplasma-x11", []string{"apt-get"}, ""},
		{"x-session-manager", "x-session-manager", []string{"apt-get"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := DEInstallHint(tc.binary, stubLookPath(tc.present...)); got != tc.want {
				t.Errorf("DEInstallHint(%q, %v) = %q, want %q", tc.binary, tc.present, got, tc.want)
			}
		})
	}
}

func TestDEInstallHintOffLinuxIsEmpty(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	for _, os := range []string{"darwin", "plan9"} {
		goos = os
		if got := DEInstallHint("startlxqt", stubLookPath("apt-get")); got != "" {
			t.Errorf("%s DEInstallHint = %q, want empty (no desktop session off Linux)", os, got)
		}
	}
}

// A nil lookPath must degrade to the generic (no manager) wording, never panic.
func TestDEInstallHintNilLookPath(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	if got := DEInstallHint("startlxqt", nil); got != "install lxqt with your package manager" {
		t.Errorf("DEInstallHint(nil lookPath) = %q, want the generic line", got)
	}
}

func TestPinInstallHintFallsBackToWM(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	apt := stubLookPath("apt-get")
	if got, want := PinInstallHint("startlxqt", apt), "sudo apt install --no-install-recommends lxqt-core"; got != want {
		t.Errorf("PinInstallHint(startlxqt) = %q, want %q (the DE line wins)", got, want)
	}
	if got, want := PinInstallHint("openbox", apt), "sudo apt install --no-install-recommends icewm"; got != want {
		t.Errorf("PinInstallHint(openbox) = %q, want %q (bare WM falls back)", got, want)
	}
	if got, want := PinInstallHint("startplasma-x11", apt), "sudo apt install --no-install-recommends icewm"; got != want {
		t.Errorf("PinInstallHint(startplasma-x11) = %q, want %q (no DE packaging line falls back)", got, want)
	}
}

func TestPackageManagerNilLookPathDetectsNothing(t *testing.T) {
	if got := PackageManager(nil); got != "" {
		t.Errorf("PackageManager(nil) = %q, want empty (nil seams are safe)", got)
	}
}

func TestWMInstallHintOffLinuxIsEmpty(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	for _, os := range []string{"darwin", "plan9"} {
		goos = os
		if got := WMInstallHint(stubLookPath("apt-get")); got != "" {
			t.Errorf("%s WMInstallHint = %q, want empty (no window manager off Linux)", os, got)
		}
	}
}
