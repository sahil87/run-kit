package tmux

import (
	"errors"
	"strings"
	"testing"
)

// lookPathWith returns a lookPath stub resolving exactly the given binaries.
func lookPathWith(found ...string) func(string) (string, error) {
	set := make(map[string]bool, len(found))
	for _, f := range found {
		set[f] = true
	}
	return func(name string) (string, error) {
		if set[name] {
			return "/usr/bin/" + name, nil
		}
		return "", errors.New("not found")
	}
}

func TestInstallHint_Darwin(t *testing.T) {
	// darwin answers before any probe — a lookPath that resolves everything
	// must not change the brew hint.
	got := InstallHint("darwin", lookPathWith("apt-get", "dnf", "pacman"))
	want := "install with: brew install tmux"
	if got != want {
		t.Errorf("InstallHint(darwin) = %q, want %q", got, want)
	}
}

func TestInstallHint_LinuxManagers(t *testing.T) {
	cases := []struct {
		binary string
		want   string
	}{
		{"apt-get", "install with: sudo apt-get install tmux"},
		{"dnf", "install with: sudo dnf install tmux"},
		{"yum", "install with: sudo yum install tmux"},
		{"pacman", "install with: sudo pacman -S tmux"},
		{"zypper", "install with: sudo zypper install tmux"},
		{"apk", "install with: sudo apk add tmux"},
	}
	for _, tc := range cases {
		t.Run(tc.binary, func(t *testing.T) {
			if got := InstallHint("linux", lookPathWith(tc.binary)); got != tc.want {
				t.Errorf("InstallHint(linux, %s) = %q, want %q", tc.binary, got, tc.want)
			}
		})
	}
}

func TestInstallHint_LinuxProbeOrder(t *testing.T) {
	// First manager in probe order wins on a multi-manager host.
	got := InstallHint("linux", lookPathWith("pacman", "apt-get"))
	want := "install with: sudo apt-get install tmux"
	if got != want {
		t.Errorf("InstallHint(linux, apt-get+pacman) = %q, want %q", got, want)
	}
}

func TestInstallHint_LinuxNoManagerFallsBack(t *testing.T) {
	got := InstallHint("linux", lookPathWith())
	if got != genericInstallHint {
		t.Errorf("InstallHint(linux, none) = %q, want %q", got, genericInstallHint)
	}
}

func TestInstallHint_OtherGOOSFallsBack(t *testing.T) {
	for _, goos := range []string{"windows", "freebsd", "openbsd"} {
		if got := InstallHint(goos, lookPathWith("apt-get")); got != genericInstallHint {
			t.Errorf("InstallHint(%s) = %q, want %q", goos, got, genericInstallHint)
		}
	}
}

func TestUpgradeHint(t *testing.T) {
	cases := []struct {
		name     string
		goos     string
		lookPath func(string) (string, error)
		want     string
	}{
		{
			// darwin answers before any probe — a lookPath resolving nothing
			// must not change the brew hint.
			"darwin", "darwin", lookPathWith(),
			"tmux 3.2a is below the supported 3.4 — upgrade with: brew upgrade tmux",
		},
		{
			"linux with brew on PATH", "linux", lookPathWith("brew"),
			"tmux 3.2a is below the supported 3.4 — upgrade with: brew install tmux",
		},
		{
			"linux without brew", "linux", lookPathWith("apt-get"),
			"tmux 3.2a is below the supported 3.4 — your distro's tmux is too old; install Homebrew (https://brew.sh) then: brew install tmux",
		},
		{
			"other GOOS falls back", "freebsd", lookPathWith("brew"),
			"tmux 3.2a is below the supported 3.4 — upgrade tmux to 3.4 or newer",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := UpgradeHint(tc.goos, tc.lookPath, "3.2a"); got != tc.want {
				t.Errorf("UpgradeHint = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestUpgradeHint_NeverRecommendsApt pins the intake's hard rule: apt cannot
// deliver tmux ≥ 3.4 on the frozen-LTS releases where the warning fires, so
// no branch of the upgrade ladder may name it — even when apt-get is the only
// package manager on PATH.
func TestUpgradeHint_NeverRecommendsApt(t *testing.T) {
	for _, goos := range []string{"darwin", "linux"} {
		got := UpgradeHint(goos, lookPathWith("apt-get", "dnf"), "3.2a")
		if strings.Contains(got, "apt") {
			t.Errorf("UpgradeHint(%s) = %q — must never recommend apt", goos, got)
		}
		if !strings.Contains(got, "3.2a") || !strings.Contains(got, FloorString) {
			t.Errorf("UpgradeHint(%s) = %q — must name the found version and the floor", goos, got)
		}
	}
}
