package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"

	"strings"
	"testing"
	"time"

	"rk/internal/codeserver"
	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

// --- seams + fixtures ---

// bareCmd returns a cobra command with the given output buffers — the
// package's direct-RunE test idiom (newSink falls back to the package-level
// quiet var when the command carries no flag set).
func bareCmd(out, errOut *bytes.Buffer) *cobra.Command {
	cmd := &cobra.Command{}
	cmd.SetOut(out)
	cmd.SetErr(errOut)
	return cmd
}

// withCodeServerCLISeams points the CLI's home/installer/start/kill seams at a
// temp home and (optionally) an httptest release server, returning recorders
// for the kill/start calls. Restores via t.Cleanup.
func withCodeServerCLISeams(t *testing.T, home string, srv *httptest.Server) (kills, starts *int) {
	t.Helper()
	kills, starts = new(int), new(int)

	origHome, origNew := codeServerUserHomeFn, newCodeServerInstallerFn
	origStart, origKill := codeServerStartFn, codeServerKillFn
	origRunning, origSession := codeServerDaemonRunningFn, codeServerSessionCommandFn
	origBusy := codeServerPortBusyFn
	t.Cleanup(func() {
		codeServerUserHomeFn, newCodeServerInstallerFn = origHome, origNew
		codeServerStartFn, codeServerKillFn = origStart, origKill
		codeServerDaemonRunningFn, codeServerSessionCommandFn = origRunning, origSession
		codeServerPortBusyFn = origBusy
	})

	// Hermetic defaults for the respawn seams: daemon up, no session, port
	// free — the migration respawn is a strict no-op and the port-free wait
	// returns immediately unless a test opts in. Never leave the real probes
	// wired (they would touch a live tmux socket or dial a real port).
	codeServerDaemonRunningFn = func() bool { return true }
	codeServerSessionCommandFn = func() (string, bool, error) { return "", false, nil }
	codeServerPortBusyFn = func() bool { return false }

	codeServerUserHomeFn = func() (string, error) { return home, nil }
	if srv != nil {
		newCodeServerInstallerFn = func() *codeserver.Installer {
			ins := codeserver.New()
			ins.APIBase = srv.URL
			ins.Client = srv.Client()
			ins.GOOS, ins.GOARCH = "linux", "amd64"
			return ins
		}
	}
	codeServerKillFn = func() (bool, error) { *kills++; return true, nil }
	codeServerStartFn = func() (daemon.EnsureOutcome, error) { *starts++; return daemon.EnsureStarted, nil }
	return kills, starts
}

// shrinkPortFreeWait shrinks the respawn's port-free wait vars so the
// never-frees branch runs without burning wall-clock (the internal/remote
// readiness-poll test idiom).
func shrinkPortFreeWait(t *testing.T) {
	t.Helper()
	origTimeout, origPoll := codeServerPortFreeTimeout, codeServerPortFreePoll
	t.Cleanup(func() { codeServerPortFreeTimeout, codeServerPortFreePoll = origTimeout, origPoll })
	codeServerPortFreeTimeout = 20 * time.Millisecond
	codeServerPortFreePoll = time.Millisecond
}

// csTarball builds a minimal code-server-shaped release tarball in memory.
func csTarball(t *testing.T, version string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	top := "code-server-" + version + "-linux-amd64"
	entry := "#!/bin/sh\n"
	for _, hdr := range []*tar.Header{
		{Name: top + "/", Typeflag: tar.TypeDir, Mode: 0o755},
		{Name: top + "/bin", Typeflag: tar.TypeDir, Mode: 0o755},
		{Name: top + "/bin/code-server", Typeflag: tar.TypeReg, Mode: 0o755, Size: int64(len(entry))},
	} {
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if hdr.Typeflag == tar.TypeReg {
			if _, err := tw.Write([]byte(entry)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// csReleaseServer serves the release listing and tarball for one version.
func csReleaseServer(t *testing.T, version string) *httptest.Server {
	t.Helper()
	payload := csTarball(t, version)
	sum := sha256.Sum256(payload)
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/coder/code-server/releases/latest":
			fmt.Fprintf(w, `{"tag_name":"v%s","assets":[{"name":"code-server-%s-linux-amd64.tar.gz","browser_download_url":%q,"digest":"sha256:%s"}]}`,
				version, version, srv.URL+"/dl/tarball", hex.EncodeToString(sum[:]))
		case "/dl/tarball":
			w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// --- R9: registration + output convention ---

func TestCodeServerTreeRegistered(t *testing.T) {
	var parent *cobra.Command
	for _, c := range rootCmd.Commands() {
		if c.Name() == "code-server" {
			parent = c
		}
	}
	if parent == nil {
		t.Fatal("rk code-server is not registered on rootCmd")
	}
	if parent.Long == "" {
		t.Error("parent command has no Long block")
	}
	want := map[string]bool{"install": false, "start": false, "update": false}
	for _, c := range parent.Commands() {
		if _, ok := want[c.Name()]; ok {
			want[c.Name()] = true
			if c.Long == "" {
				t.Errorf("%s has no Long block", c.Name())
			}
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("subcommand %q not registered", name)
		}
	}
}

func TestCodeServerArgValidationIsUsageClass(t *testing.T) {
	for _, c := range codeServerCmd.Commands() {
		if err := c.Args(c, []string{"extra"}); err == nil {
			t.Errorf("%s accepted a positional arg", c.Name())
		} else if code := exitCode(err); code != exitUsage {
			t.Errorf("%s arg violation exit code = %d, want %d (usage)", c.Name(), code, exitUsage)
		}
	}
}

func TestCodeServerInstallOutcomeLines(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	withCodeServerCLISeams(t, home, srv)

	var out, errOut bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &errOut), nil); err != nil {
		t.Fatal(err)
	}
	wantPath := codeserver.VersionDir(home, "4.132.0")
	if got, want := out.String(), fmt.Sprintf("Installed code-server v4.132.0 (%s).\n", wantPath); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestCodeServerInstallAlreadyCurrentQuiet(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	withCodeServerCLISeams(t, home, srv)

	var out bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}

	// Second run under --quiet: stdout carries EXACTLY the outcome line and
	// stderr is empty (R9's GIVEN/WHEN/THEN).
	origQuiet := quiet
	quiet = true
	t.Cleanup(func() { quiet = origQuiet })
	out.Reset()
	var errOut bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &errOut), nil); err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("code-server v4.132.0 is already current (%s).\n", codeserver.VersionDir(home, "4.132.0"))
	if out.String() != want {
		t.Errorf("stdout = %q, want exactly %q", out.String(), want)
	}
	if errOut.Len() != 0 {
		t.Errorf("stderr = %q, want empty under --quiet", errOut.String())
	}
}

// --- R10: start ---

func TestCodeServerStartAlreadyRunning(t *testing.T) {
	withCodeServerCLISeams(t, t.TempDir(), nil)
	codeServerStartFn = func() (daemon.EnsureOutcome, error) { return daemon.EnsureAlreadyRunning, nil }

	var out bytes.Buffer
	if err := runCodeServerStart(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "already running") {
		t.Errorf("stdout = %q, want the already-running data line", out.String())
	}
}

func TestCodeServerStartDaemonDownPropagates(t *testing.T) {
	withCodeServerCLISeams(t, t.TempDir(), nil)
	codeServerStartFn = func() (daemon.EnsureOutcome, error) {
		return daemon.EnsureAlreadyRunning, fmt.Errorf("rk daemon is not running — start it with `rk serve -d`")
	}

	err := runCodeServerStart(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), nil)
	if err == nil || !strings.Contains(err.Error(), "rk serve -d") {
		t.Errorf("err = %v, want the daemon-down error naming `rk serve -d`", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1 (operational)", code)
	}
}

// --- R11: update ---

func TestCodeServerUpdateNotManagedSkips(t *testing.T) {
	home := t.TempDir() // no ~/.rk/code-server-bin
	kills, starts := withCodeServerCLISeams(t, home, nil)
	installerBuilt := false
	newCodeServerInstallerFn = func() *codeserver.Installer {
		installerBuilt = true
		return codeserver.New()
	}

	var out bytes.Buffer
	if err := runCodeServerUpdate(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "No rk-managed code-server install") {
		t.Errorf("stdout = %q, want the not-managed skip line", out.String())
	}
	if installerBuilt {
		t.Error("installer constructed despite the not-managed skip")
	}
	if *kills != 0 || *starts != 0 {
		t.Errorf("kills=%d starts=%d, want 0/0 — a PATH install is never touched", *kills, *starts)
	}
}

func TestCodeServerUpdateAlreadyCurrentNoRestart(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, starts := withCodeServerCLISeams(t, home, srv)

	// Establish the managed install at the latest version.
	if err := runCodeServerInstall(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	if err := runCodeServerUpdate(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "already current") {
		t.Errorf("stdout = %q, want the already-current line", out.String())
	}
	if *kills != 0 || *starts != 0 {
		t.Errorf("kills=%d starts=%d, want 0/0 — already-current short-circuits the restart", *kills, *starts)
	}
}

func TestCodeServerUpdateChangedVersionRespawns(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, starts := withCodeServerCLISeams(t, home, srv)
	if err := runCodeServerInstall(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}

	// Upstream moves to 4.133.0.
	srv2 := csReleaseServer(t, "4.133.0")
	origNew := newCodeServerInstallerFn
	newCodeServerInstallerFn = func() *codeserver.Installer {
		ins := codeserver.New()
		ins.APIBase = srv2.URL
		ins.Client = srv2.Client()
		ins.GOOS, ins.GOARCH = "linux", "amd64"
		return ins
	}
	t.Cleanup(func() { newCodeServerInstallerFn = origNew })

	var out bytes.Buffer
	if err := runCodeServerUpdate(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if *kills != 1 || *starts != 1 {
		t.Errorf("kills=%d starts=%d, want 1/1 — a version change respawns the session", *kills, *starts)
	}
	want := fmt.Sprintf("Updated code-server v4.132.0 -> v4.133.0 (%s).\n", codeserver.VersionDir(home, "4.133.0"))
	if !strings.Contains(out.String(), want) {
		t.Errorf("stdout = %q, want it to contain %q", out.String(), want)
	}
}

// The update flow prints "Restarting..." before the start call, but
// StartCodeServer can legitimately decline to respawn when the port is
// already externally served — the flow must then say so.
func TestCodeServerUpdateExternallyManagedNotesNoRespawn(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	withCodeServerCLISeams(t, home, srv)
	if err := runCodeServerInstall(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}

	// Upstream moves to 4.133.0, and the start seam reports the port as
	// externally managed instead of respawning.
	srv2 := csReleaseServer(t, "4.133.0")
	origNew := newCodeServerInstallerFn
	newCodeServerInstallerFn = func() *codeserver.Installer {
		ins := codeserver.New()
		ins.APIBase = srv2.URL
		ins.Client = srv2.Client()
		ins.GOOS, ins.GOARCH = "linux", "amd64"
		return ins
	}
	t.Cleanup(func() { newCodeServerInstallerFn = origNew })
	codeServerStartFn = func() (daemon.EnsureOutcome, error) { return daemon.EnsureExternallyManaged, nil }

	var out, errOut bytes.Buffer
	if err := runCodeServerUpdate(bareCmd(&out, &errOut), nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(errOut.String(), "externally managed code-server; the updated binary was not respawned") {
		t.Errorf("stderr = %q, want the externally-managed note", errOut.String())
	}
}

// --- R1/R4: the daemon gate on the respawn ---

// With the daemon down, an update that flipped versions must touch no tmux at
// all (no kill, no start — even the has-session probe would birth a server on
// a dead socket) and print the manual recovery chain.
func TestCodeServerUpdateDaemonDownNoKillNamesManualChain(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, starts := withCodeServerCLISeams(t, home, srv)
	if err := runCodeServerInstall(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}

	srv2 := csReleaseServer(t, "4.133.0")
	origNew := newCodeServerInstallerFn
	newCodeServerInstallerFn = func() *codeserver.Installer {
		ins := codeserver.New()
		ins.APIBase = srv2.URL
		ins.Client = srv2.Client()
		ins.GOOS, ins.GOARCH = "linux", "amd64"
		return ins
	}
	t.Cleanup(func() { newCodeServerInstallerFn = origNew })
	codeServerDaemonRunningFn = func() bool { return false }

	var out bytes.Buffer
	if err := runCodeServerUpdate(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if *kills != 0 || *starts != 0 {
		t.Errorf("kills=%d starts=%d, want 0/0 — the gate fires before any tmux command", *kills, *starts)
	}
	if !strings.Contains(out.String(), "tmux -L rk-daemon kill-session -t '=rk-code-server' && rk code-server start") {
		t.Errorf("stdout = %q, want the manual recovery chain", out.String())
	}
	if !strings.Contains(out.String(), "Updated code-server v4.132.0 -> v4.133.0") {
		t.Errorf("stdout = %q, want the install outcome line — the flip itself succeeded", out.String())
	}
}

// --- the respawn kill→probe race window (260818-nzho) ---

// (a) Killed session, port busy then freed: the respawn waits out the dying
// instance and start runs against a free port — no externally-managed
// misclassification of rk's own process.
func TestRespawnWaitsForKilledPortToFree(t *testing.T) {
	withCodeServerCLISeams(t, t.TempDir(), nil)
	shrinkPortFreeWait(t)
	probes, startsAfterFree := 0, false
	codeServerPortBusyFn = func() bool {
		probes++
		return probes <= 2 // busy, busy, free
	}
	codeServerStartFn = func() (daemon.EnsureOutcome, error) {
		startsAfterFree = probes >= 3
		return daemon.EnsureStarted, nil
	}

	out, err := respawnCodeServerSession(newSink(bareCmd(&bytes.Buffer{}, &bytes.Buffer{})), "4.133.0")
	if err != nil || out != respawnDone {
		t.Fatalf("got (%v, %v), want (respawnDone, nil)", out, err)
	}
	if probes < 3 {
		t.Errorf("port probes = %d, want the wait to poll past the busy reports", probes)
	}
	if !startsAfterFree {
		t.Error("start ran before the port probe reported free")
	}
}

// (b) Killed session, port never frees: the budget expires and the respawn
// falls through to start unchanged — the externally-managed classification
// remains the (truthful) outcome, no new error path.
func TestRespawnPortNeverFreesFallsThrough(t *testing.T) {
	withCodeServerCLISeams(t, t.TempDir(), nil)
	shrinkPortFreeWait(t)
	codeServerPortBusyFn = func() bool { return true }
	codeServerStartFn = func() (daemon.EnsureOutcome, error) { return daemon.EnsureExternallyManaged, nil }

	var errOut bytes.Buffer
	out, err := respawnCodeServerSession(newSink(bareCmd(&bytes.Buffer{}, &errOut)), "4.133.0")
	if err != nil || out != respawnExternallyManaged {
		t.Fatalf("got (%v, %v), want (respawnExternallyManaged, nil) on budget expiry", out, err)
	}
	if !strings.Contains(errOut.String(), "externally managed") {
		t.Errorf("stderr = %q, want the existing externally-managed note", errOut.String())
	}
}

// (c) No session existed (killed=false): no wait — the port probe is never
// consulted and start runs immediately.
func TestRespawnNoSessionSkipsWait(t *testing.T) {
	withCodeServerCLISeams(t, t.TempDir(), nil)
	codeServerKillFn = func() (bool, error) { return false, nil }
	probed := false
	codeServerPortBusyFn = func() bool { probed = true; return false }
	started := false
	codeServerStartFn = func() (daemon.EnsureOutcome, error) { started = true; return daemon.EnsureStarted, nil }

	out, err := respawnCodeServerSession(newSink(bareCmd(&bytes.Buffer{}, &bytes.Buffer{})), "4.133.0")
	if err != nil || out != respawnDone {
		t.Fatalf("got (%v, %v), want (respawnDone, nil)", out, err)
	}
	if probed {
		t.Error("port probed despite killed=false — the wait must be gated on a real kill")
	}
	if !started {
		t.Error("start not called")
	}
}

// A kill failure still short-circuits before any wait or start.
func TestRespawnKillErrorNoWaitNoStart(t *testing.T) {
	withCodeServerCLISeams(t, t.TempDir(), nil)
	codeServerKillFn = func() (bool, error) { return false, fmt.Errorf("kill failed") }
	probed, started := false, false
	codeServerPortBusyFn = func() bool { probed = true; return false }
	codeServerStartFn = func() (daemon.EnsureOutcome, error) { started = true; return daemon.EnsureStarted, nil }

	out, err := respawnCodeServerSession(newSink(bareCmd(&bytes.Buffer{}, &bytes.Buffer{})), "4.133.0")
	if err == nil || out != respawnFailed {
		t.Fatalf("got (%v, %v), want (respawnFailed, non-nil)", out, err)
	}
	if probed || started {
		t.Errorf("probed=%v started=%v, want false/false after a kill error", probed, started)
	}
}

// --- R2/R3: install's migration respawn ---

// installedAt establishes the managed install at the given version and returns
// the managed binary path (the classification anchor).
func installedAt(t *testing.T, home string) string {
	t.Helper()
	if err := runCodeServerInstall(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	managed := codeserver.ManagedBinary(home)
	if managed == "" {
		t.Fatal("managed binary not resolvable after install")
	}
	return managed
}

func TestCodeServerInstallMigratesForeignSession(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, starts := withCodeServerCLISeams(t, home, srv)
	installedAt(t, home) // seed the managed install; the migration check runs on the re-run below

	// A brew-era session: its start command names a PATH binary, not the
	// managed current path.
	codeServerSessionCommandFn = func() (string, bool, error) {
		return "env -u VSCODE_IPC_HOOK_CLI code-server --bind-addr 127.0.0.1:3002 --auth none", true, nil
	}

	var out bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if *kills != 1 || *starts != 1 {
		t.Errorf("kills=%d starts=%d, want 1/1 — a foreign session is respawned", *kills, *starts)
	}
	if !strings.Contains(out.String(), "Respawned code-server onto the managed v4.132.0") {
		t.Errorf("stdout = %q, want the migration respawn data line", out.String())
	}
}

// The migration fires on the already-current outcome too — a re-run after a
// daemon-down skip must converge. (The test above IS the already-current case:
// the install was seeded first. This one pins the managed-session negative.)
func TestCodeServerInstallManagedSessionNoRespawn(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, starts := withCodeServerCLISeams(t, home, srv)
	managed := installedAt(t, home)

	codeServerSessionCommandFn = func() (string, bool, error) {
		return "env -u VSCODE_IPC_HOOK_CLI " + managed + " --bind-addr 127.0.0.1:3002 --auth none", true, nil
	}

	var out bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if *kills != 0 || *starts != 0 {
		t.Errorf("kills=%d starts=%d, want 0/0 — a managed-rung session is never respawned by install", *kills, *starts)
	}
}

// No session ⇒ install's respawn step is a strict no-op — the rk-jobs
// `install && start` chain invariant (the job fires only when nothing was
// spawned, and start owns the spawn).
func TestCodeServerInstallNoSessionNoOp(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, starts := withCodeServerCLISeams(t, home, srv)

	var out bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if *kills != 0 || *starts != 0 {
		t.Errorf("kills=%d starts=%d, want 0/0 — no session means nothing to migrate", *kills, *starts)
	}
	if strings.Contains(out.String(), "Respawned") {
		t.Errorf("stdout = %q, want no respawn line", out.String())
	}
}

func TestCodeServerInstallDaemonDownSkipsMigrationCheck(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, starts := withCodeServerCLISeams(t, home, srv)
	codeServerDaemonRunningFn = func() bool { return false }
	sessionQueried := false
	codeServerSessionCommandFn = func() (string, bool, error) {
		sessionQueried = true
		return "", false, nil
	}

	var out bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &bytes.Buffer{}), nil); err != nil {
		t.Fatal(err)
	}
	if sessionQueried {
		t.Error("session inspected with the daemon down — the gate must fire before any tmux command")
	}
	if *kills != 0 || *starts != 0 {
		t.Errorf("kills=%d starts=%d, want 0/0", *kills, *starts)
	}
	if !strings.Contains(out.String(), "run `rk code-server install` again once the daemon is up") {
		t.Errorf("stdout = %q, want the re-run recovery line", out.String())
	}
}

// A query error on an existing session is uncertain evidence — note it, never
// kill on it.
func TestCodeServerInstallSessionQueryErrorSkips(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	kills, _ := withCodeServerCLISeams(t, home, srv)
	codeServerSessionCommandFn = func() (string, bool, error) {
		return "", true, fmt.Errorf("tmux query failed")
	}

	var out, errOut bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &errOut), nil); err != nil {
		t.Fatal(err)
	}
	if *kills != 0 {
		t.Errorf("kills=%d, want 0 — never kill on uncertain evidence", *kills)
	}
	if !strings.Contains(errOut.String(), "leaving it untouched") {
		t.Errorf("stderr = %q, want the inspection-failure note", errOut.String())
	}
}

// The migration respawn respects the externally-managed outcome: the kill
// happened, the start declined, and the flow must not claim a respawn.
func TestCodeServerInstallMigrationExternallyManagedNoClaim(t *testing.T) {
	home := t.TempDir()
	srv := csReleaseServer(t, "4.132.0")
	withCodeServerCLISeams(t, home, srv)
	installedAt(t, home)
	codeServerSessionCommandFn = func() (string, bool, error) {
		return "code-server --bind-addr 127.0.0.1:3002", true, nil
	}
	codeServerStartFn = func() (daemon.EnsureOutcome, error) { return daemon.EnsureExternallyManaged, nil }

	var out, errOut bytes.Buffer
	if err := runCodeServerInstall(bareCmd(&out, &errOut), nil); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "Respawned code-server onto the managed") {
		t.Errorf("stdout = %q, want no respawn claim when the start declined", out.String())
	}
	if !strings.Contains(errOut.String(), "externally managed") {
		t.Errorf("stderr = %q, want the externally-managed note", errOut.String())
	}
}

// Guard the managed-dir gate against a stat error surfacing as a skip.
func TestCodeServerUpdateHomeErrorIsOperational(t *testing.T) {
	withCodeServerCLISeams(t, t.TempDir(), nil)
	codeServerUserHomeFn = func() (string, error) { return "", fmt.Errorf("no home") }

	err := runCodeServerUpdate(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), nil)
	if err == nil {
		t.Error("err = nil, want an operational error when home is unresolvable")
	}
}
