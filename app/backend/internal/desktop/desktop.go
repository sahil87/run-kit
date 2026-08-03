// Package desktop installs and updates the Run Kit desktop app (the Electron
// viewer shell, app/desktop) from GitHub release DMGs.
//
// Why this exists: the desktop DMGs are ad-hoc signed (no notarization), so a
// browser download stamps com.apple.quarantine and Gatekeeper blocks the app
// on every install AND every update. Quarantine is applied by the DOWNLOADING
// application (via LSFileQuarantineEnabled) — browsers set it, plain
// command-line tools do not — so a Go program fetching over HTTPS produces a
// genuinely quarantine-free install. Because this code path deliberately
// bypasses Gatekeeper's own check, the installer performs the verification
// itself: SHA256 against the release digest (when the API supplies one) and
// `codesign --verify --deep --strict` on the mounted .app — both are hard
// gates that no flag can skip (see install.go).
//
// The package is electron-free and fully seam-parameterized: an *http.Client
// for the GitHub API + asset download, and a Runner func for every subprocess
// (hdiutil, ditto, codesign, plutil, pgrep). Both are struct fields (not
// package vars) so parallel tests do not race — the same idiom as
// internal/updatecheck's checkFn. The whole flow unit-tests on Linux with an
// httptest server and a recorded runner; only the real end-to-end run needs a
// Mac.
package desktop

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	// DefaultRepo is the GitHub repository the desktop DMGs are released from.
	DefaultRepo = "sahil87/run-kit"
	// DefaultInstallDir is the standard macOS application directory. Overridable
	// via the --path flag for managed-Mac / non-writable scenarios.
	DefaultInstallDir = "/Applications"
	// AppBundleName is the installed bundle name (electron-builder's
	// productName "Run Kit" + .app).
	AppBundleName = "Run Kit.app"
	// assetPrefix is the leading segment of every desktop DMG asset name
	// (run-kit-desktop-{version}-{arch}.dmg, per the release CI's
	// artifactName convention).
	assetPrefix = "run-kit-desktop-"
	// defaultAPIBase is the GitHub REST API origin.
	defaultAPIBase = "https://api.github.com"
)

// Subprocess and network bounds. Constitution § Process Execution requires a
// timeout on every exec.CommandContext; the constitution's named tiers are
// tmux (5-10s) and build ops (30s), and the intake sizes this flow "at the
// build-op tier or above": the DMG is ~110MB (downloadTimeout is
// network-transfer-sized), and codesign --deep --strict reads every file of an
// Electron bundle (~200MB unpacked), so the verify/copy bounds are generous
// rather than tight. All are upper bounds on failure, not expected durations.
const (
	apiTimeout      = 30 * time.Second
	downloadTimeout = 15 * time.Minute
	attachTimeout   = 2 * time.Minute
	codesignTimeout = 5 * time.Minute
	dittoTimeout    = 5 * time.Minute
	detachTimeout   = 1 * time.Minute
	probeTimeout    = 10 * time.Second
)

// Runner executes an external command and returns its stdout. The default
// implementation (runCommand) uses exec.CommandContext with an explicit
// argument slice — never a shell string (Constitution I). Tests substitute a
// recorder so the whole install flow runs without macOS tools.
type Runner func(ctx context.Context, name string, args ...string) ([]byte, error)

// Installer holds the seams and configuration for the desktop-app install
// flow. Construct with New() and override fields as needed; all methods are
// safe for a zero-concurrency CLI use (no internal locking — one command, one
// installer).
type Installer struct {
	// Client performs the GitHub API request and the asset download.
	Client *http.Client
	// Run executes subprocesses (hdiutil, ditto, codesign, plutil, pgrep).
	Run Runner
	// Repo is the {owner}/{repo} the releases are resolved from.
	Repo string
	// Arch is the host architecture (runtime.GOARCH shape: "arm64"/"amd64").
	Arch string
	// APIBase is the GitHub API origin (overridden by tests with httptest).
	APIBase string
	// Token, when non-empty, is sent as a Bearer token — purely for rate-limit
	// headroom on the public repo (see githubToken).
	Token string
	// InstallDir is the target application directory.
	InstallDir string
	// Progress receives human progress/decoration output (the caller wires it
	// to the chatter channel, so --quiet suppresses it). Never nil after New().
	Progress io.Writer
	// QuitWait bounds how long the swap phase waits for a quit app's processes
	// to exit before aborting (see restart.go). A struct field (not a bare
	// const) so tests can shrink the bound instead of sleeping 30s wall-clock.
	QuitWait time.Duration
	// QuitPoll is the cadence of the AppRunning poll during that wait.
	QuitPoll time.Duration
}

// New returns an Installer with production defaults.
func New() *Installer {
	return &Installer{
		Client:     &http.Client{}, // per-call contexts carry the timeouts
		Run:        runCommand,
		Repo:       DefaultRepo,
		Arch:       runtime.GOARCH,
		APIBase:    defaultAPIBase,
		Token:      githubToken(),
		InstallDir: DefaultInstallDir,
		Progress:   io.Discard,
		QuitWait:   quitWaitTimeout,
		QuitPoll:   quitPollInterval,
	}
}

// githubToken resolves a token for rate-limit headroom, preferring the
// environment (GITHUB_TOKEN, then GH_TOKEN — the pair gh itself honours) and
// falling back to the gh CLI's stored credential. The fallback exists because
// an interactive `gh auth login` is the common way a Mac has GitHub
// credentials at all, and without it a plain `rk desktop install` shares the
// 60 req/hour-per-IP unauthenticated budget with every other tool on the
// network. Every outcome is optional: no gh, gh not logged in, or gh timing
// out all yield "" and the request simply goes out unauthenticated.
func githubToken() string {
	for _, env := range []string{"GITHUB_TOKEN", "GH_TOKEN"} {
		if v := os.Getenv(env); v != "" {
			return v
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "gh", "auth", "token").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// AppPath returns the install target bundle path
// (e.g. /Applications/Run Kit.app).
func (ins *Installer) AppPath() string {
	return filepath.Join(ins.InstallDir, AppBundleName)
}

// runCommand is the default Runner: exec.CommandContext with an argument
// slice, stdout captured, and stderr detail folded into a non-nil error so
// failures stay diagnosable.
func runCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			if detail := bytes.TrimSpace(ee.Stderr); len(detail) > 0 {
				return out, fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, detail)
			}
		}
		return out, fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return out, nil
}
