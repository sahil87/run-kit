package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/tmux"
)

// tabTestServer starts an isolated tmux server ("boot" session) and points
// the own-tab seams at it: $TMUX reads as the server's socket and
// display-message reads run for real through the ownTabRunOutputFn seam.
// Skips when tmux is unavailable; the server is killed on cleanup.
type tabTestEnv struct {
	server string
	socket string
	bootID string // the boot window's @N
	paneID string // the boot window's initial pane (%N)
}

func withTabTestServer(t *testing.T) *tabTestEnv {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	server := fmt.Sprintf("rk-test-tab-%d-%d", os.Getpid(), time.Now().UnixNano())
	socket := filepath.Join(os.TempDir(), fmt.Sprintf("tmux-%d", os.Getuid()), server)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-session", "-d", "-s", "boot").CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, string(out))
	}
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})

	env := &tabTestEnv{server: server, socket: socket}
	env.bootID = tabTmuxOut(t, server, "display-message", "-p", "#{window_id}")
	env.paneID = tabTmuxOut(t, server, "display-message", "-p", "#{pane_id}")

	origTMUX := ownTabOriginalTMUXFn
	ownTabOriginalTMUXFn = func() string { return socket + ",1,0" }
	t.Setenv("TMUX_PANE", env.paneID)
	t.Cleanup(func() { ownTabOriginalTMUXFn = origTMUX })
	return env
}

// tabTmuxOut runs a raw tmux command on the test server, failing on error.
func tabTmuxOut(t *testing.T, server string, args ...string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	full := append([]string{"-L", server}, args...)
	out, err := exec.CommandContext(ctx, "tmux", full...).CombinedOutput()
	if err != nil {
		t.Fatalf("tmux %v: %v\n%s", args, err, string(out))
	}
	return strings.TrimSpace(string(out))
}

// tabWindowOption reads one window option via show-options -wqv ("" = unset).
func tabWindowOption(t *testing.T, server, windowID, option string) string {
	t.Helper()
	return tabTmuxOut(t, server, "show-options", "-wqv", "-t", windowID, option)
}

// tabTmuxDo runs a raw tmux command, ignoring its output.
func tabTmuxDo(t *testing.T, server string, args ...string) {
	t.Helper()
	tabTmuxOut(t, server, args...)
}

// runTabCmd drives `rk tab <args...>` through the real cobra Execute() seam
// (the present_test.go runPresentCmd pattern) so arg/flag validation and exit
// classification run exactly as in production.
func runTabCmd(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	resetTabFlagState(t)
	var stdout, stderr strings.Builder
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(append([]string{"tab"}, args...))
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	err := rootCmd.Execute()
	return stdout.String(), stderr.String(), err
}

// resetTabFlagState clears every tab-family flag value and Changed marker so
// one Execute() run never bleeds into the next (the present_test.go idiom).
func resetTabFlagState(t *testing.T) {
	t.Helper()
	reset := func() {
		resetFlagChanged(tabCmd, "server")
		resetFlagChanged(tabNewCmd, "session", "cwd", "name", "layout")
		resetFlagChanged(tabLayoutCmd, "add", "rm", "promote", "cycle")
		resetFlagChanged(tabWebAddCmd, "show")
		resetFlagChanged(tabWebLsCmd, "json")
		resetFlagChanged(tabShowCmd, "json")
		tabServerFlag = ""
		tabNewSessionFlag, tabNewCwdFlag, tabNewNameFlag, tabNewLayoutFlag = "", "", "", ""
		tabLayoutAddFlag, tabLayoutRmFlag, tabLayoutPromoteFlag, tabLayoutCycleFlag = "", "", "", false
		tabWebAddShowFlag, tabWebLsJSONFlag = false, false
		tabShowJSONFlag = false
	}
	reset()
	t.Cleanup(reset)
}

// tabTestListener opens a throwaway TCP listener so ProbePort succeeds for a
// :port target.
func tabTestListener(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	return ln.Addr().(*net.TCPAddr).Port
}

// ── rk tab new ──────────────────────────────────────────────────────────────

func TestTabNewPrintsIDAndWritesLayoutAtCreation(t *testing.T) {
	env := withTabTestServer(t)

	stdout, _, err := runTabCmd(t, "new", "--layout", "split-h:tty,web", "--name", "newtab")
	if err != nil {
		t.Fatalf("tab new: %v", err)
	}
	id := strings.TrimSpace(stdout)
	if !strings.HasPrefix(id, "@") {
		t.Fatalf("stdout = %q, want @N", stdout)
	}
	if got := tabWindowOption(t, env.server, id, tmux.LayoutOption); got != "split-h:tty,web" {
		t.Errorf("@rk_win_layout = %q, want split-h:tty,web", got)
	}
	if got := tabTmuxOut(t, env.server, "display-message", "-pt", id, "#{window_name}"); got != "newtab" {
		t.Errorf("window name = %q, want newtab", got)
	}
	// The default session is the caller's own (boot — TMUX_PANE is set).
	if got := tabTmuxOut(t, env.server, "display-message", "-pt", id, "#{session_name}"); got != "boot" {
		t.Errorf("session = %q, want boot", got)
	}
}

func TestTabNewBadLayoutExitsTwoAndCreatesNothing(t *testing.T) {
	env := withTabTestServer(t)
	before := tabTmuxOut(t, env.server, "list-windows", "-t", "=boot:", "-F", "#{window_id}")

	stdout, _, err := runTabCmd(t, "new", "--layout", "bogus")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("err = %v (code %d), want usage exit 2", err, exitCode(err))
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on failure", stdout)
	}
	if after := tabTmuxOut(t, env.server, "list-windows", "-t", "=boot:", "-F", "#{window_id}"); after != before {
		t.Errorf("windows changed on a failed new: %q → %q", before, after)
	}
}

// ── rk tab layout ───────────────────────────────────────────────────────────

func TestTabLayoutSetAndReadForm(t *testing.T) {
	env := withTabTestServer(t)

	stdout, _, err := runTabCmd(t, "layout", env.bootID, "main-left:tty,code,web")
	if err != nil {
		t.Fatalf("layout set: %v", err)
	}
	if stdout != "main-left:tty,code,web\n" {
		t.Errorf("stdout = %q", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.LayoutOption); got != "main-left:tty,code,web" {
		t.Errorf("@rk_win_layout = %q", got)
	}

	// Read-only form prints the value and writes nothing.
	stdout, _, err = runTabCmd(t, "layout", env.bootID)
	if err != nil {
		t.Fatalf("layout read: %v", err)
	}
	if stdout != "main-left:tty,code,web\n" {
		t.Errorf("read stdout = %q", stdout)
	}

	// Malformed positional is a usage error, option untouched.
	if _, _, err := runTabCmd(t, "layout", env.bootID, "bogus"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("malformed: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.LayoutOption); got != "main-left:tty,code,web" {
		t.Errorf("@rk_win_layout = %q after a failed set", got)
	}
}

func TestTabLayoutUnsetReadsAsSingleTty(t *testing.T) {
	env := withTabTestServer(t)

	stdout, _, err := runTabCmd(t, "layout", env.bootID)
	if err != nil {
		t.Fatalf("layout read: %v", err)
	}
	if stdout != "single:tty\n" {
		t.Errorf("stdout = %q, want single:tty", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.LayoutOption); got != "" {
		t.Errorf("@rk_win_layout = %q, want untouched (unset)", got)
	}
}

func TestTabLayoutMutationsRoundTrip(t *testing.T) {
	env := withTabTestServer(t)
	id := env.bootID

	// Unset + --add web reads as single:tty and grows through the table.
	stdout, _, err := runTabCmd(t, "layout", id, "--add", "web")
	if err != nil {
		t.Fatalf("--add web: %v", err)
	}
	if stdout != "split-h:tty,web\n" {
		t.Errorf("stdout = %q, want split-h:tty,web", stdout)
	}
	if got := tabWindowOption(t, env.server, id, tmux.LayoutOption); got != "split-h:tty,web" {
		t.Errorf("@rk_win_layout = %q", got)
	}

	if stdout, _, err = runTabCmd(t, "layout", id, "--add", "code"); err != nil || stdout != "main-left:tty,web,code\n" {
		t.Errorf("--add code: stdout = %q, err = %v, want main-left:tty,web,code", stdout, err)
	}
	if _, _, err = runTabCmd(t, "layout", id, "--add", "chat"); err == nil || exitCode(err) != 1 {
		t.Errorf("--add chat on a full layout: err = %v (code %d), want exit 1", err, exitCode(err))
	}
	if stdout, _, err = runTabCmd(t, "layout", id, "--rm", "code"); err != nil || stdout != "split-h:tty,web\n" {
		t.Errorf("--rm code: stdout = %q, err = %v, want split-h:tty,web", stdout, err)
	}
	if _, _, err = runTabCmd(t, "layout", id, "--rm", "web"); err != nil {
		t.Fatalf("--rm web: %v", err)
	}
	// single:tty refuses to close its last tile.
	if _, _, err = runTabCmd(t, "layout", id, "--rm", "tty"); err == nil || exitCode(err) != 1 {
		t.Errorf("--rm tty on single: err = %v (code %d), want exit 1", err, exitCode(err))
	}
	// An unknown surface is user input — usage error.
	if _, _, err = runTabCmd(t, "layout", id, "--add", "bogus"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("--add bogus: err = %v (code %d), want exit 2", err, exitCode(err))
	}

	// --promote and --cycle on a 3-tile layout.
	if _, _, err = runTabCmd(t, "layout", id, "main-left:tty,web,code"); err != nil {
		t.Fatalf("set: %v", err)
	}
	if stdout, _, err = runTabCmd(t, "layout", id, "--promote", "code"); err != nil || stdout != "main-left:code,tty,web\n" {
		t.Errorf("--promote code: stdout = %q, err = %v, want main-left:code,tty,web", stdout, err)
	}
	if stdout, _, err = runTabCmd(t, "layout", id, "--cycle"); err != nil || stdout != "main-right:code,tty,web\n" {
		t.Errorf("--cycle: stdout = %q, err = %v, want main-right:code,tty,web", stdout, err)
	}
	// --promote of an absent surface is operational.
	if _, _, err = runTabCmd(t, "layout", id, "--promote", "chat"); err == nil || exitCode(err) != 1 {
		t.Errorf("--promote chat: err = %v (code %d), want exit 1", err, exitCode(err))
	}
}

func TestTabLayoutUnparseableStoredValueReplaced(t *testing.T) {
	env := withTabTestServer(t)
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", env.bootID, tmux.LayoutOption, "bogus")

	stdout, stderr, err := runTabCmd(t, "layout", env.bootID, "--add", "web")
	if err != nil {
		t.Fatalf("--add web over garbage: %v", err)
	}
	if stdout != "split-h:tty,web\n" {
		t.Errorf("stdout = %q, want split-h:tty,web", stdout)
	}
	if !strings.Contains(stderr, "bogus") {
		t.Errorf("stderr = %q, want a note naming the replaced value", stderr)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.LayoutOption); got != "split-h:tty,web" {
		t.Errorf("@rk_win_layout = %q", got)
	}
}

// ── rk tab web add ──────────────────────────────────────────────────────────

func TestTabWebAddPrintsAddressAndShowGrowsLayout(t *testing.T) {
	env := withTabTestServer(t)
	port := tabTestListener(t)

	stdout, stderr, err := runTabCmd(t, "web", "add", env.bootID, fmt.Sprintf(":%d", port), "--show")
	if err != nil {
		t.Fatalf("web add: %v", err)
	}
	wantURL := fmt.Sprintf("/proxy/%d/", port)
	if stdout != env.bootID+"/web/1\n" {
		t.Errorf("stdout = %q, want %s/web/1", stdout, env.bootID)
	}
	if !strings.Contains(stderr, "url: "+wantURL) {
		t.Errorf("stderr = %q, want a url: note", stderr)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.WebTabOption(1)); got != wantURL {
		t.Errorf("@rk_win_web_1 = %q, want %q", got, wantURL)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.WebActiveOption); got != "1" {
		t.Errorf("@rk_win_web_active = %q, want 1", got)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.LayoutOption); got != "split-h:tty,web" {
		t.Errorf("@rk_win_layout = %q, want split-h:tty,web", got)
	}
}

func TestTabWebAddIdempotent(t *testing.T) {
	env := withTabTestServer(t)
	port := tabTestListener(t)
	target := fmt.Sprintf(":%d", port)

	if _, _, err := runTabCmd(t, "web", "add", env.bootID, target); err != nil {
		t.Fatalf("web add: %v", err)
	}
	stdout, _, err := runTabCmd(t, "web", "add", env.bootID, target)
	if err != nil {
		t.Fatalf("web re-add: %v", err)
	}
	if stdout != env.bootID+"/web/1\n" {
		t.Errorf("stdout = %q, want the existing slot", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.WebTabOption(2)); got != "" {
		t.Errorf("@rk_win_web_2 = %q, want no duplicate append", got)
	}
}

func TestTabWebAddFullExitsOne(t *testing.T) {
	env := withTabTestServer(t)
	for n := 1; n <= tmux.MaxWebTabs; n++ {
		tabTmuxDo(t, env.server, "set-option", "-w", "-t", env.bootID, tmux.WebTabOption(n), fmt.Sprintf("/proxy/%d/", n))
	}

	_, _, err := runTabCmd(t, "web", "add", env.bootID, "https://new.example.com")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v (code %d), want exit 1", err, exitCode(err))
	}
	if !strings.Contains(err.Error(), "full") {
		t.Errorf("err = %v, want a full message", err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.WebTabOption(tmux.MaxWebTabs)); got != "/proxy/8/" {
		t.Errorf("family changed on a full add: web_8 = %q", got)
	}
}

func TestTabWebAddShowReplacesLastSlotOnFullLayout(t *testing.T) {
	env := withTabTestServer(t)
	port := tabTestListener(t)
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", env.bootID, tmux.LayoutOption, "main-left:tty,code,chat")

	stdout, _, err := runTabCmd(t, "web", "add", env.bootID, fmt.Sprintf(":%d", port), "--show")
	if err != nil {
		t.Fatalf("web add --show: %v", err)
	}
	if stdout != env.bootID+"/web/1\n" {
		t.Errorf("stdout = %q", stdout)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.LayoutOption); got != "main-left:tty,code,web" {
		t.Errorf("@rk_win_layout = %q, want main-left:tty,code,web (slot A untouched)", got)
	}
}

// ── rk tab web rm / select ─────────────────────────────────────────────────

func TestTabWebRmRenumbersAndRepoints(t *testing.T) {
	env := withTabTestServer(t)
	id := env.bootID
	for i, u := range []string{"/proxy/1/", "/proxy/2/", "/proxy/3/"} {
		tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebTabOption(i+1), u)
	}
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebTabRootOption(3), "/r3")
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebActiveOption, "3")

	stdout, _, err := runTabCmd(t, "web", "rm", id+"/web/2")
	if err != nil {
		t.Fatalf("web rm: %v", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on success", stdout)
	}
	if got := tabWindowOption(t, env.server, id, tmux.WebTabOption(1)); got != "/proxy/1/" {
		t.Errorf("web_1 = %q", got)
	}
	if got := tabWindowOption(t, env.server, id, tmux.WebTabOption(2)); got != "/proxy/3/" {
		t.Errorf("web_2 = %q, want /proxy/3/ (shifted)", got)
	}
	t.Logf("options after rm:\n%s", tabTmuxOut(t, env.server, "show-options", "-w", "-t", id))
	if got := tabWindowOption(t, env.server, id, tmux.WebTabRootOption(2)); got != "/r3" {
		t.Errorf("web_2_root = %q, want /r3 (moved with its URL)", got)
	}
	if got := tabWindowOption(t, env.server, id, tmux.WebTabRootOption(3)); got != "" {
		t.Errorf("web_3_root = %q, want unset", got)
	}
	if got := tabWindowOption(t, env.server, id, tmux.WebTabOption(3)); got != "" {
		t.Errorf("web_3 = %q, want unset", got)
	}
	if got := tabWindowOption(t, env.server, id, tmux.WebActiveOption); got != "2" {
		t.Errorf("active = %q, want 2", got)
	}
}

func TestTabWebSelectAndBounds(t *testing.T) {
	env := withTabTestServer(t)
	id := env.bootID
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebTabOption(1), "/proxy/1/")

	stdout, _, err := runTabCmd(t, "web", "select", id+"/web/1")
	if err != nil || stdout != "" {
		t.Errorf("select 1: stdout = %q, err = %v", stdout, err)
	}
	if got := tabWindowOption(t, env.server, id, tmux.WebActiveOption); got != "1" {
		t.Errorf("active = %q", got)
	}

	// Out-of-range <n> is operational and names the family length.
	if _, _, err := runTabCmd(t, "web", "select", "3"); err == nil || exitCode(err) != 1 {
		t.Errorf("select 3: err = %v (code %d), want exit 1", err, exitCode(err))
	} else if !strings.Contains(err.Error(), "family has 1") {
		t.Errorf("err = %v, want the family length named", err)
	}
	// A slot-less address is usage.
	if _, _, err := runTabCmd(t, "web", "rm", id); err == nil || exitCode(err) != exitUsage {
		t.Errorf("rm with no <n>: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	// Out-of-range rm is operational.
	if _, _, err := runTabCmd(t, "web", "rm", "web/5"); err == nil || exitCode(err) != 1 {
		t.Errorf("rm web/5: err = %v (code %d), want exit 1", err, exitCode(err))
	}
}

// ── rk tab web ls ───────────────────────────────────────────────────────────

func TestTabWebLsHumanAndJSON(t *testing.T) {
	env := withTabTestServer(t)
	id := env.bootID
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebTabOption(1), "/proxy/1/")
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebTabOption(2), "/proxy/2/")
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebActiveOption, "2")

	stdout, _, err := runTabCmd(t, "web", "ls", id)
	if err != nil {
		t.Fatalf("web ls: %v", err)
	}
	lines := strings.Split(strings.TrimRight(stdout, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("stdout = %q, want 2 rows", stdout)
	}
	if !strings.Contains(lines[0], "1") || strings.Contains(lines[0], "*") {
		t.Errorf("row 1 = %q, want unmarked", lines[0])
	}
	if !strings.Contains(lines[1], "*") || !strings.Contains(lines[1], "/proxy/2/") {
		t.Errorf("row 2 = %q, want * and /proxy/2/", lines[1])
	}

	stdout, _, err = runTabCmd(t, "web", "ls", id, "--json")
	if err != nil {
		t.Fatalf("web ls --json: %v", err)
	}
	if !strings.Contains(stdout, `"windowId":"`+id+`"`) || !strings.Contains(stdout, `"active":2`) ||
		!strings.Contains(stdout, `"index":1`) || !strings.Contains(stdout, `"url":"/proxy/2/"`) {
		t.Errorf("json = %q", stdout)
	}
	if strings.Contains(stdout, "root") {
		t.Errorf("json = %q, want root omitted when empty", stdout)
	}
}

func TestTabWebLsEmpty(t *testing.T) {
	env := withTabTestServer(t)

	stdout, _, err := runTabCmd(t, "web", "ls", env.bootID)
	if err != nil || stdout != "" {
		t.Errorf("ls: stdout = %q, err = %v, want empty output exit 0", stdout, err)
	}
	stdout, _, err = runTabCmd(t, "web", "ls", env.bootID, "--json")
	if err != nil {
		t.Fatalf("ls --json: %v", err)
	}
	if !strings.Contains(stdout, `"tabs":[]`) {
		t.Errorf("json = %q, want tabs: []", stdout)
	}
}

// ── rk tab code set ─────────────────────────────────────────────────────────

func TestTabCodeSet(t *testing.T) {
	env := withTabTestServer(t)
	dir := t.TempDir()

	stdout, _, err := runTabCmd(t, "code", "set", env.bootID, dir)
	if err != nil {
		t.Fatalf("code set: %v", err)
	}
	abs, _ := filepath.Abs(dir)
	if stdout != abs+"\n" {
		t.Errorf("stdout = %q, want %q", stdout, abs)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.CodeRootOption); got != abs {
		t.Errorf("@rk_win_code_root = %q, want %q", got, abs)
	}

	if _, _, err := runTabCmd(t, "code", "set", env.bootID, filepath.Join(dir, "missing")); err == nil || exitCode(err) != 1 {
		t.Errorf("missing dir: err = %v (code %d), want exit 1", err, exitCode(err))
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.CodeRootOption); got != abs {
		t.Errorf("@rk_win_code_root = %q after a failed set, want untouched", got)
	}
}

// ── rk tab show ─────────────────────────────────────────────────────────────

func TestTabShow(t *testing.T) {
	env := withTabTestServer(t)
	id := env.bootID

	// Nothing set: empty stdout, exit 0.
	stdout, _, err := runTabCmd(t, "show", id)
	if err != nil || stdout != "" {
		t.Errorf("empty show: stdout = %q, err = %v", stdout, err)
	}

	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.LayoutOption, "split-h:tty,web")
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", id, tmux.WebTabOption(1), "/proxy/8080/")

	stdout, _, err = runTabCmd(t, "show", id)
	if err != nil {
		t.Fatalf("show: %v", err)
	}
	lines := strings.Split(strings.TrimRight(stdout, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("stdout = %q, want 2 sorted rows", stdout)
	}
	if !strings.HasPrefix(lines[0], tmux.LayoutOption) || !strings.Contains(lines[0], "split-h:tty,web") {
		t.Errorf("row 1 = %q", lines[0])
	}
	if !strings.HasPrefix(lines[1], tmux.WebTabOption(1)) {
		t.Errorf("row 2 = %q, want sorted by key", lines[1])
	}

	stdout, _, err = runTabCmd(t, "show", id, "--json")
	if err != nil {
		t.Fatalf("show --json: %v", err)
	}
	if !strings.Contains(stdout, `"@rk_win_layout":"split-h:tty,web"`) ||
		!strings.Contains(stdout, `"@rk_win_web_1":"/proxy/8080/"`) {
		t.Errorf("json = %q", stdout)
	}
}

// ── server and own-tab resolution ───────────────────────────────────────────

func TestTabServerFlagWithoutAddressExitsTwo(t *testing.T) {
	withTabTestServer(t)

	if _, _, err := runTabCmd(t, "-L", "other", "web", "ls"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("err = %v (code %d), want exit 2", err, exitCode(err))
	}
}

func TestTabForeignServerAddress(t *testing.T) {
	env := withTabTestServer(t)

	// -L names the caller's own test server explicitly: an @N address
	// resolves there without a pane.
	stdout, _, err := runTabCmd(t, "-L", env.server, "web", "ls", env.bootID, "--json")
	if err != nil {
		t.Fatalf("ls -L: %v", err)
	}
	if !strings.Contains(stdout, `"windowId":"`+env.bootID+`"`) {
		t.Errorf("json = %q", stdout)
	}
}

func TestTabOutsideTmuxWithoutAddressExitsOne(t *testing.T) {
	env := withTabTestServer(t)
	t.Setenv("TMUX_PANE", "")

	_, _, err := runTabCmd(t, "web", "ls")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v (code %d), want exit 1", err, exitCode(err))
	}
	if !strings.Contains(err.Error(), "@N") {
		t.Errorf("err = %v, want the fix named (pass @N)", err)
	}
	_ = env
}

func TestTabOwnTabAddressForms(t *testing.T) {
	env := withTabTestServer(t)
	tabTmuxDo(t, env.server, "set-option", "-w", "-t", env.bootID, tmux.WebTabOption(1), "/proxy/1/")

	// Bare <n> and web/<n> address the caller's own tab (TMUX_PANE set).
	if _, _, err := runTabCmd(t, "web", "select", "1"); err != nil {
		t.Errorf("select 1: %v", err)
	}
	if _, _, err := runTabCmd(t, "web", "select", "web/1"); err != nil {
		t.Errorf("select web/1: %v", err)
	}
	if got := tabWindowOption(t, env.server, env.bootID, tmux.WebActiveOption); got != "1" {
		t.Errorf("active = %q", got)
	}
	// =session:window resolves exactly like @N.
	if _, _, err := runTabCmd(t, "web", "ls", "=boot:0", "--json"); err != nil {
		t.Errorf("ls =boot:0: %v", err)
	}
	// A bare session:window is rejected (the rk mux rule).
	if _, _, err := runTabCmd(t, "web", "ls", "boot:0"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("ls boot:0: err = %v (code %d), want exit 2", err, exitCode(err))
	}
}

func TestTabUsageArgCounts(t *testing.T) {
	withTabTestServer(t)

	if _, _, err := runTabCmd(t, "web", "add"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("web add with no target: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if _, _, err := runTabCmd(t, "web", "rm"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("web rm with no address: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if _, _, err := runTabCmd(t, "code", "set"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("code set with no folder: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	if _, _, err := runTabCmd(t, "show", "@1", "@2"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("show with two args: err = %v (code %d), want exit 2", err, exitCode(err))
	}
}
