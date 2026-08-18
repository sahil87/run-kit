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
