package codeserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"rk/internal/codebridge"
)

// bridgeInstallTimeout bounds the code-server --install-extension subprocess:
// a Node boot plus extension extraction takes seconds, so two minutes is a
// generous ceiling (every subprocess carries an explicit timeout,
// Constitution I).
const bridgeInstallTimeout = 2 * time.Minute

// ExtensionsDir is code-server's DEFAULT extensions location:
// $XDG_DATA_HOME/code-server/extensions, else ~/.local/share/code-server/
// extensions. Pinned explicitly because code-server derives its default
// extensions dir from the user-data-dir (<user-data-dir>/extensions), so
// overriding the data dir alone would hide the user's installed extensions.
// Shared by the daemon's spawn flags, the bridge-extension install step, and
// the doctor row.
func ExtensionsDir(home string) string {
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return filepath.Join(v, "code-server", "extensions")
	}
	return filepath.Join(home, ".local", "share", "code-server", "extensions")
}

// InstalledBridgeVersion reports the installed rk-code-bridge extension
// version by scanning <extensionsDir>/run-kit.rk-code-bridge-*/package.json —
// code-server's stable on-disk layout (<publisher>.<name>-<version>). Pure
// filesystem, no subprocess, so it works when code-server is not running.
// Absence is a state, not an error: ("", nil). When a partial upgrade left
// several version dirs behind, the numerically greatest version wins.
func InstalledBridgeVersion(extensionsDir string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(extensionsDir, "run-kit.rk-code-bridge-*", "package.json"))
	if err != nil {
		return "", err
	}
	best := ""
	for _, manifest := range matches {
		data, err := os.ReadFile(manifest)
		if err != nil {
			return "", fmt.Errorf("reading %s: %w", manifest, err)
		}
		var pkg struct {
			Version string `json:"version"`
		}
		if err := json.Unmarshal(data, &pkg); err != nil {
			return "", fmt.Errorf("parsing %s: %w", manifest, err)
		}
		if best == "" || codebridge.OlderThan(best, pkg.Version) {
			best = pkg.Version
		}
	}
	return best, nil
}

// InstallBridgeExtension installs the bundled rk-code-bridge VSIX into the
// shared extensions dir via the managed code-server binary. When the
// installed version already matches, it prints a skip note to progress and
// reports changed=false without spawning anything. Otherwise the VSIX is
// staged in a private temp dir (0700 by MkdirTemp, removed after — the
// release artifact is never left in a shared temp location) and installed
// with `code-server --install-extension <vsix> --extensions-dir <dir>
// --force` under an explicit-timeout exec.CommandContext with an argument
// slice (Constitution I).
//
// The installed-outcome line is the caller's to print (it owns the
// stdout/stderr split); a failure is returned for the caller to downgrade to
// a warning — the code-server binary install already succeeded, so an
// extension failure must never fail the verb.
func InstallBridgeExtension(ctx context.Context, home string, vsix []byte, version string, progress io.Writer) (changed bool, err error) {
	extDir := ExtensionsDir(home)
	installed, err := InstalledBridgeVersion(extDir)
	if err != nil {
		return false, fmt.Errorf("reading the installed code bridge version: %w", err)
	}
	if installed == version {
		fmt.Fprintf(progress, "code bridge extension v%s already installed\n", version)
		return false, nil
	}

	binary := ManagedBinary(home)
	if binary == "" {
		return false, fmt.Errorf("managed code-server binary not resolvable — install it with `rk code-server install`")
	}

	tmp, err := os.MkdirTemp("", "rk-code-bridge-")
	if err != nil {
		return false, fmt.Errorf("creating the VSIX staging dir: %w", err)
	}
	defer os.RemoveAll(tmp)
	vsixPath := filepath.Join(tmp, "rk-code-bridge-"+version+".vsix")
	if err := os.WriteFile(vsixPath, vsix, 0o600); err != nil {
		return false, fmt.Errorf("staging the VSIX: %w", err)
	}

	installCtx, cancel := context.WithTimeout(ctx, bridgeInstallTimeout)
	defer cancel()
	cmd := exec.CommandContext(installCtx, binary, "--install-extension", vsixPath, "--extensions-dir", extDir, "--force")
	if out, err := cmd.CombinedOutput(); err != nil {
		return false, fmt.Errorf("code-server --install-extension: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return true, nil
}
