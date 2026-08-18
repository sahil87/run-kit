package tmux

import (
	"errors"
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
