package tmux

// linuxPackageManagers maps package-manager binaries to their tmux install
// commands, probed in slice order (first found wins) so multi-manager hosts
// resolve deterministically.
var linuxPackageManagers = []struct {
	binary  string
	command string
}{
	{"apt-get", "sudo apt-get install tmux"},
	{"dnf", "sudo dnf install tmux"},
	{"yum", "sudo yum install tmux"},
	{"pacman", "sudo pacman -S tmux"},
	{"zypper", "sudo zypper install tmux"},
	{"apk", "sudo apk add tmux"},
}

// genericInstallHint is the fallback when no platform-specific instruction
// applies — the historical doctor hint text, preserved byte-identically.
const genericInstallHint = "install tmux and ensure it is on PATH"

// InstallHint returns a platform-appropriate tmux install instruction for
// remediation messages (the doctor tmux check, the daemon-start precheck).
// goos is runtime.GOOS; lookPath is exec.LookPath, injected so tests can
// exercise every branch without depending on the host PATH. The helper only
// probes — it never executes anything.
func InstallHint(goos string, lookPath func(string) (string, error)) string {
	switch goos {
	case "darwin":
		return "install with: brew install tmux"
	case "linux":
		for _, pm := range linuxPackageManagers {
			if _, err := lookPath(pm.binary); err == nil {
				return "install with: " + pm.command
			}
		}
	}
	return genericInstallHint
}

// UpgradeHint composes the full below-floor message shared by every consumer
// (the daemon-start warning, the `rk serve` startup warning, the doctor tmux
// note, and the remote-tunnels gate) so all four render byte-identical text.
// The ladder deliberately never recommends apt — apt cannot deliver tmux ≥
// 3.4 on the frozen-LTS releases where the warning fires, so brew is the
// answer on both platforms (the shll.ai install path already hard-requires
// Homebrew on Linux). goos is runtime.GOOS; lookPath is exec.LookPath,
// injected so tests exercise every branch without depending on the host PATH
// (the helper only probes — it never executes anything).
func UpgradeHint(goos string, lookPath func(string) (string, error), raw string) string {
	fix := "upgrade tmux to " + FloorString + " or newer"
	switch goos {
	case "darwin":
		fix = "upgrade with: brew upgrade tmux"
	case "linux":
		if _, err := lookPath("brew"); err == nil {
			fix = "upgrade with: brew install tmux"
		} else {
			fix = "your distro's tmux is too old; install Homebrew (https://brew.sh) then: brew install tmux"
		}
	}
	return "tmux " + raw + " is below the supported " + FloorString + " — " + fix
}
