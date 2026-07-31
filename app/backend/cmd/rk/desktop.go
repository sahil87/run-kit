package main

import (
	"context"
	"fmt"
	"runtime"

	"rk/internal/desktop"
	"rk/internal/updatecheck"

	"github.com/spf13/cobra"
)

// desktopGOOS is the platform the macOS-only gate checks. A seam var (not
// runtime.GOOS inline) so tests can exercise both the gate and the darwin
// flows deterministically on any host — the innerServePIDFn/runBrewFn idiom.
var desktopGOOS = runtime.GOOS

// newDesktopInstallerFn constructs the installer for the desktop subcommands.
// Package-level seam (mirrors runBrewFn/resolveExeFn in upgrade.go) so
// desktop_test.go can substitute an installer wired to an httptest server and
// a recorded runner without network or macOS tools.
var newDesktopInstallerFn = func() *desktop.Installer { return desktop.New() }

// errDesktopMacOnly is the platform-gate refusal. The commands stay REGISTERED
// on every platform so the `rk help-dump` command tree is platform-stable
// (help-dump is a contract surface per the toolkit standards); only running
// them is gated. Operational failure — exit 1.
var errDesktopMacOnly = fmt.Errorf("rk desktop is macOS-only (the shell is packaged as a macOS .app)")

// desktopRestartAnnouncement is the auto-restart outcome line — data (stdout,
// survives --quiet): a caller must be able to tell "updated in place" from
// "updated and the running app was restarted" (Toolkit Principle 9).
const desktopRestartAnnouncement = "Run Kit was running — restarted on the new version.\n"

var desktopCmd = &cobra.Command{
	Use:   "desktop",
	Short: "Install and update the Run Kit desktop app (macOS)",
	Long: `Install and update the Run Kit desktop app — the Electron shell that wraps an
rk serve dashboard (macOS only).

Why not just download the DMG? A browser download stamps the app with
com.apple.quarantine, so Gatekeeper blocks it on every install and every
update ("Apple could not verify..."). Fetching through this command produces a
quarantine-free install: quarantine is applied by the downloading application,
and command-line tools do not apply it. The installer verifies the download
itself (SHA256 against the release digest when available, plus
codesign --verify --deep --strict on the app) before installing.

A running app does not block install/update: the new version is downloaded,
verified, and staged while the app runs, then the app is asked to quit
gracefully, the bundle is swapped atomically, and the app is relaunched on the
new version (the VSCode update pattern).

Subcommands:
  install  Fetch the latest release DMG and install to /Applications
  update   Same, but a no-op when the installed app is already current
  status   Show installed version vs latest (read-only)

See 'run-kit desktop <subcommand> --help' for flags on each.`,
	PersistentPreRunE: func(_ *cobra.Command, _ []string) error {
		if desktopGOOS != "darwin" {
			return errDesktopMacOnly
		}
		return nil
	},
}

var desktopInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Download and install the Run Kit desktop app (quarantine-free)",
	Long: `Download the latest desktop release DMG (or a specific release via --version)
and install it, quarantine-free.

The download is verified before anything is touched: SHA256 against the
release digest when the API supplies one, plus codesign --verify --deep
--strict on the mounted app. The new bundle is then staged next to the install
target and swapped in atomically, so a failed download or copy never destroys
an existing install.

A running Run Kit app is handled automatically: it is asked to quit gracefully
just before the swap, then relaunched on the new version. If it does not quit
within the wait bound, the install aborts with the existing app untouched.

When the resolved version is already installed, the command is a no-op;
--force reinstalls anyway. --force overrides version state ONLY — it does not
change how a running app is handled (quit, swap, relaunch).

--path installs somewhere other than /Applications — e.g. ~/Applications on a
managed Mac where /Applications is not writable.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runDesktopInstall,
}

var desktopUpdateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the Run Kit desktop app when a newer release exists",
	Long: `Update the Run Kit desktop app to the latest release. A no-op (exit 0) when
the installed app is already current; errors when no app is installed (run
'run-kit desktop install' first).

The installed version is read from the app bundle's Info.plist at check time —
never assumed equal to the CLI version. There is deliberately no --version
flag: update means "go to latest"; to pin a specific release use
'run-kit desktop install --version <tag>'.

A running Run Kit app is handled automatically: the new version is staged
while the app runs, then the app is quit gracefully, swapped, and relaunched.
If it does not quit within the wait bound, the update aborts with the existing
app untouched.

--force reinstalls even when already current. It overrides version state ONLY
— it does not change how a running app is handled (quit, swap, relaunch).

--path targets an install outside /Applications — e.g. ~/Applications on a
managed Mac where /Applications is not writable.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runDesktopUpdate,
}

var desktopStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show installed vs latest Run Kit desktop app version (read-only)",
	Long: `Show the installed Run Kit desktop app version against the latest GitHub
release, and whether an update is available. Read-only: nothing is downloaded
or modified. The report is the requested result (data), so --quiet changes
nothing.

--path points at an install outside /Applications — e.g. ~/Applications on a
managed Mac.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runDesktopStatus,
}

func init() {
	desktopInstallCmd.Flags().String("version", "", "install a specific release tag instead of the latest (e.g. v3.13.0)")
	desktopInstallCmd.Flags().Bool("force", false, "reinstall even when the requested version is already installed")
	desktopInstallCmd.Flags().String("path", desktop.DefaultInstallDir, "install directory")
	desktopUpdateCmd.Flags().Bool("force", false, "reinstall even when already current")
	desktopUpdateCmd.Flags().String("path", desktop.DefaultInstallDir, "install directory")
	desktopStatusCmd.Flags().String("path", desktop.DefaultInstallDir, "install directory")

	desktopCmd.AddCommand(desktopInstallCmd)
	desktopCmd.AddCommand(desktopUpdateCmd)
	desktopCmd.AddCommand(desktopStatusCmd)

	// Arg-count violations on the children are usage-class (exit 2). root.go's
	// central wrap loop covers only rootCmd's direct children, so nested
	// subcommands wrap their own validators here (same one-place idiom).
	for _, c := range desktopCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
}

// desktopInstaller builds the configured installer for a command invocation:
// the --path flag sets the install directory and download/verify progress is
// wired to the sink's chatter channel (dropped by --quiet; outcome lines stay
// data per Toolkit Principle 9). An explicitly-empty --path is a usage error
// (exit 2) — silently substituting /Applications would contradict the flag.
func desktopInstaller(cmd *cobra.Command, sink outputSink) (*desktop.Installer, error) {
	p, err := cmd.Flags().GetString("path")
	if err != nil {
		return nil, err
	}
	if p == "" {
		return nil, usageError(fmt.Errorf("--path requires a non-empty directory (omit the flag for the %s default)", desktop.DefaultInstallDir))
	}
	ins := newDesktopInstallerFn()
	ins.InstallDir = p
	ins.Progress = sink.chatter
	return ins, nil
}

func runDesktopInstall(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	ins, err := desktopInstaller(cmd, sink)
	if err != nil {
		return err
	}
	ctx := cmd.Context()
	tag, _ := cmd.Flags().GetString("version")
	force, _ := cmd.Flags().GetBool("force")

	sink.Notef("Resolving release...\n")
	rel, err := ins.ResolveRelease(ctx, tag)
	if err != nil {
		return err
	}

	installed, err := ins.InstalledVersion(ctx)
	if err != nil {
		return err
	}
	if !force && installed == rel.Version {
		// Outcome line — data: silence would misreport the no-op.
		sink.Dataf("Run Kit v%s is already installed (%s). Use --force to reinstall.\n", installed, ins.AppPath())
		return nil
	}

	res, err := ins.Install(ctx, rel)
	if err != nil {
		return err
	}
	sink.Dataf("Installed Run Kit v%s to %s\n", res.Version, res.Path)
	if res.Restarted {
		sink.Dataf(desktopRestartAnnouncement)
	}
	return nil
}

func runDesktopUpdate(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	ins, err := desktopInstaller(cmd, sink)
	if err != nil {
		return err
	}
	ctx := cmd.Context()
	force, _ := cmd.Flags().GetBool("force")

	installed, err := ins.InstalledVersion(ctx)
	if err != nil {
		return err
	}
	if installed == "" {
		// An update of nothing is a user error, not a silent no-op.
		return fmt.Errorf("Run Kit is not installed at %s — run 'rk desktop install' first", ins.AppPath())
	}

	return desktopUpdateToLatest(ctx, ins, sink, installed, force)
}

// desktopUpdateToLatest updates an installed desktop app to the latest
// release: resolve → compare (updatecheck.AnyIncrease, unless force) →
// install (auto-restarting a running app) → outcome lines. Shared by
// `rk desktop update` and the umbrella `rk update` desktop leg so the two
// flows — and their data-line shapes — cannot drift. The caller has already
// established that an app is installed (installed != "").
func desktopUpdateToLatest(ctx context.Context, ins *desktop.Installer, sink outputSink, installed string, force bool) error {
	sink.Notef("Installed: v%s — checking the latest release...\n", installed)
	rel, err := ins.ResolveRelease(ctx, "")
	if err != nil {
		return err
	}
	if !force && !updatecheck.AnyIncrease(installed, rel.Version) {
		// Outcome line — data (mirrors `rk update`'s already-up-to-date shape).
		sink.Dataf("Already up to date (v%s).\n", installed)
		return nil
	}

	res, err := ins.Install(ctx, rel)
	if err != nil {
		return err
	}
	sink.Dataf("Updated Run Kit v%s -> v%s (%s)\n", installed, res.Version, res.Path)
	if res.Restarted {
		sink.Dataf(desktopRestartAnnouncement)
	}
	return nil
}

func runDesktopStatus(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	ins, err := desktopInstaller(cmd, sink)
	if err != nil {
		return err
	}
	ctx := cmd.Context()

	installed, err := ins.InstalledVersion(ctx)
	if err != nil {
		return err
	}
	rel, err := ins.ResolveRelease(ctx, "")
	if err != nil {
		return err
	}

	// Everything status prints is data — a read-only report is the requested
	// result, so --quiet legitimately changes nothing (the rk status / reaper
	// posture).
	if installed == "" {
		sink.Dataf("Installed: not installed\n")
		sink.Dataf("Latest:    v%s\n", rel.Version)
		sink.Dataf("Run 'rk desktop install' to install.\n")
		return nil
	}
	sink.Dataf("Installed: v%s\n", installed)
	sink.Dataf("Latest:    v%s\n", rel.Version)
	if updatecheck.AnyIncrease(installed, rel.Version) {
		sink.Dataf("Update available — run 'rk desktop update'.\n")
	} else {
		sink.Dataf("Up to date.\n")
	}
	return nil
}
