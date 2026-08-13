package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"

	"rk/internal/codeserver"
	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

// codeServerUserHomeFn resolves the user's home for the managed-install
// paths. A package seam (mirroring resolveExeFn) so tests point the managed
// dir at a temp dir and never touch the real ~/.rk.
var codeServerUserHomeFn = os.UserHomeDir

// newCodeServerInstallerFn constructs the installer for the code-server
// subcommands. Package-level seam (mirrors newDesktopInstallerFn) so tests
// substitute an installer wired to an httptest server.
var newCodeServerInstallerFn = func() *codeserver.Installer { return codeserver.New() }

// codeServerStartFn / codeServerKillFn are the package seams over the daemon
// package's exported start/kill entries (StartCodeServer carries the
// daemon-running gate; KillCodeServerSession no-ops on an absent session), so
// tests drive the update respawn without a live tmux server.
var codeServerStartFn = daemon.StartCodeServer
var codeServerKillFn = daemon.KillCodeServerSession

var codeServerCmd = &cobra.Command{
	Use:   "code-server",
	Short: "Manage the rk-owned code-server install (the /code lens editor)",
	Long: `Manage the rk-owned code-server install — the editor behind the dashboard's
/code lens.

run-kit installs code-server itself: the official standalone release tarball
(SHA256-verified against the GitHub release digest) lands under
~/.rk/code-server-bin/<version>/, activated by an atomic 'current' symlink
flip. The daemon installs it automatically on first start (a code-server-install
window in the rk-jobs session) when neither the managed install nor a
code-server on PATH resolves; these subcommands are the manual surface for the
same paths — and the only ones a remote host without Homebrew needs.

A code-server you installed yourself on PATH is always respected and never
touched: 'update' acts only when ~/.rk/code-server-bin exists.

Subcommands:
  install  Download the latest release and activate it (idempotent)
  start    Start the daemon-managed code-server session now
  update   Install the latest release and respawn the session to apply it

See 'run-kit code-server <subcommand> --help' for details.`,
}

var codeServerInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Download the latest code-server release and activate it",
	Long: `Download the latest standalone code-server release tarball for this host
(linux/macos, amd64/arm64) from the official GitHub releases, verify its
SHA256 against the release digest, and activate it under
~/.rk/code-server-bin/<version>/ via an atomic 'current' symlink flip.

Idempotent: when the managed install already matches the latest release,
nothing is downloaded and the command prints the already-current outcome. A
missing or mismatched digest fails closed — no unverified binary is ever
activated, and a failed run leaves the previous install untouched.

There is deliberately no version-pin flag: install means "go to latest".`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runCodeServerInstall,
}

var codeServerStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the daemon-managed code-server session now",
	Long: `Start the daemon-managed code-server session (rk-code-server, a sibling of
rk-daemon on the same tmux socket) — the same ensure path 'rk daemon start'
runs, exposed as a subcommand so the rk-jobs install chain and manual recovery
share one implementation.

Gated on the daemon running: any tmux command on a dead socket would silently
birth a server, so a down daemon is an operational error — start it with
'rk serve -d' first.

Idempotent: an existing session or an already-serving port (an externally
managed instance) is a skip, not an error. A missing binary IS an error here
(unlike the daemon's warn-and-continue posture): install it first with
'rk code-server install'.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runCodeServerStart,
}

var codeServerUpdateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the managed code-server to the latest release",
	Long: `Update the rk-managed code-server install to the latest release and make it
take effect: the rk-code-server session is killed and respawned on the new
binary (code-server's hot exit preserves unsaved buffers; the /code lens
reconnects briefly).

Ownership posture: with no ~/.rk/code-server-bin, the command is a skip (exit
0 with a data line) — a code-server you installed yourself on PATH is never
touched. When the managed install is already current, nothing is downloaded
and the session is NOT restarted.

'rk update' runs this leg automatically (best-effort) after upgrading the CLI.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runCodeServerUpdate,
}

func init() {
	codeServerCmd.AddCommand(codeServerInstallCmd)
	codeServerCmd.AddCommand(codeServerStartCmd)
	codeServerCmd.AddCommand(codeServerUpdateCmd)

	// Arg-count violations on the children are usage-class (exit 2). root.go's
	// central wrap loop covers only rootCmd's direct children, so nested
	// subcommands wrap their own validators here (same one-place idiom as
	// desktop.go).
	for _, c := range codeServerCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
}

// codeServerHome resolves the home directory for the managed-install paths.
func codeServerHome() (string, error) {
	home, err := codeServerUserHomeFn()
	if err != nil {
		return "", fmt.Errorf("resolving home directory: %w", err)
	}
	return home, nil
}

// codeServerInstallToLatest runs the shared install path and prints the
// outcome lines. Returns (result, changed, err): changed=false is the
// already-current skip (callers — update — key the session respawn on it).
func codeServerInstallToLatest(cmd *cobra.Command, sink outputSink, home string) (codeserver.InstallResult, bool, error) {
	ins := newCodeServerInstallerFn()
	ins.Progress = sink.chatter
	sink.Notef("Resolving the latest code-server release...\n")
	// cmd.Context() is set by Execute(); direct RunE invocations (the
	// package's test idiom) leave it nil, so fall back explicitly.
	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	res, err := ins.Install(ctx, home)
	if err != nil {
		return codeserver.InstallResult{}, false, err
	}
	if res.AlreadyCurrent {
		// Outcome line — data: silence would misreport the no-op.
		sink.Dataf("code-server v%s is already current (%s).\n", res.Version, res.Path)
		return res, false, nil
	}
	return res, true, nil
}

func runCodeServerInstall(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	home, err := codeServerHome()
	if err != nil {
		return err
	}
	res, changed, err := codeServerInstallToLatest(cmd, sink, home)
	if err != nil {
		return err
	}
	if changed {
		sink.Dataf("Installed code-server v%s (%s).\n", res.Version, res.Path)
	}
	return nil
}

func runCodeServerStart(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	outcome, err := codeServerStartFn()
	if err != nil {
		return err
	}
	switch outcome {
	case daemon.EnsureAlreadyRunning:
		sink.Dataf("code-server is already running (%s session).\n", daemon.CodeServerSessionName)
	case daemon.EnsureExternallyManaged:
		sink.Dataf("code-server port already serving; respecting the externally managed instance.\n")
	case daemon.EnsureStarted:
		sink.Dataf("Started code-server (%s session).\n", daemon.CodeServerSessionName)
	}
	return nil
}

// runCodeServerUpdateFlow is the R11 update semantics as a plain function so
// both `rk code-server update` and the `rk update` code-server leg share one
// implementation (the leg wraps the error instead of returning it). The
// returned error is operational; the not-managed skip and the already-current
// skip are nil-error outcomes.
func runCodeServerUpdateFlow(cmd *cobra.Command, sink outputSink) error {
	home, err := codeServerHome()
	if err != nil {
		return err
	}
	if _, err := os.Stat(codeserver.BinDir(home)); errors.Is(err, fs.ErrNotExist) {
		// Only touch what rk owns — a user-managed PATH install is never
		// shadowed as a side effect of an update verb.
		sink.Dataf("No rk-managed code-server install (%s absent) — leaving any PATH install untouched.\n", codeserver.BinDir(home))
		return nil
	} else if err != nil {
		return fmt.Errorf("checking %s: %w", codeserver.BinDir(home), err)
	}

	before, err := codeserver.InstalledVersion(home)
	if err != nil {
		return fmt.Errorf("reading the active code-server version: %w", err)
	}
	res, changed, err := codeServerInstallToLatest(cmd, sink, home)
	if err != nil {
		return err
	}
	if !changed {
		return nil // already current — no restart either
	}

	// Take effect: kill the session (absent ⇒ no-op) and re-run the gated
	// start path on the flipped symlink.
	sink.Notef("Restarting the code-server session on v%s...\n", res.Version)
	if err := codeServerKillFn(); err != nil {
		return err
	}
	outcome, err := codeServerStartFn()
	if err != nil {
		return fmt.Errorf("respawning code-server after the update (the new version IS installed — start it with `rk code-server start`): %w", err)
	}
	if outcome == daemon.EnsureExternallyManaged {
		// StartCodeServer legitimately declines to respawn when the port is
		// already serving — say so, or the "Restarting" line above misleads.
		sink.Notef("Port already serving — respecting the externally managed code-server; the updated binary was not respawned.\n")
	}
	if before == "" {
		sink.Dataf("Installed code-server v%s (%s).\n", res.Version, res.Path)
	} else {
		sink.Dataf("Updated code-server v%s -> v%s (%s).\n", before, res.Version, res.Path)
	}
	return nil
}

func runCodeServerUpdate(cmd *cobra.Command, _ []string) error {
	return runCodeServerUpdateFlow(cmd, newSink(cmd))
}
