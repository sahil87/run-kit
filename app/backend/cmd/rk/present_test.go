package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/present"
	"rk/internal/tmux"
)

// presentTestEnv installs the present command's seams with fakes and returns
// observers for the faked tmux/notify interactions. The default fake session
// is pane %3 on window @7 of server "dev" (socket /tmp/tmux-1000/dev).
type presentFake struct {
	displayArgs  [][]string
	setOpsWindow []string
	setOpsServer []string
	setOps       [][]tmux.WindowOptionOp
	created      []presentCreated
	createdID    []presentCreatedID
	notified     []string
	probed       []int
}

type presentCreated struct {
	session, name, server string
	ops                   []tmux.WindowOptionOp
}

type presentCreatedID struct {
	session, name, server string
	ops                   []tmux.WindowOptionOp
}

func installPresentFakes(t *testing.T) *presentFake {
	t.Helper()
	f := &presentFake{}

	presentOriginalTMUXFn = func() string { return "/tmp/tmux-1000/dev,123,0" }
	presentRunOutputFn = func(_ context.Context, args []string) ([]byte, error) {
		f.displayArgs = append(f.displayArgs, args)
		joined := strings.Join(args, " ")
		switch {
		case strings.Contains(joined, "#{window_id}"):
			return []byte("@7\n"), nil
		case strings.Contains(joined, "#{session_name}"):
			return []byte("work\n"), nil
		}
		return nil, fmt.Errorf("unexpected tmux read: %s", joined)
	}
	presentSetWindowOptionsFn = func(_ context.Context, windowID, server string, ops []tmux.WindowOptionOp) error {
		f.setOpsWindow = append(f.setOpsWindow, windowID)
		f.setOpsServer = append(f.setOpsServer, server)
		f.setOps = append(f.setOps, ops)
		return nil
	}
	presentCreateWindowFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) error {
		f.created = append(f.created, presentCreated{session, name, server, ops})
		return nil
	}
	presentCreateWindowIDFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) (string, error) {
		f.createdID = append(f.createdID, presentCreatedID{session, name, server, ops})
		return "@42", nil
	}
	presentProbeFn = func(_ context.Context, port int) error {
		f.probed = append(f.probed, port)
		return nil
	}
	presentNotifyFn = func(_ context.Context, title, body string) {
		f.notified = append(f.notified, body)
	}
	presentNowFn = func() int64 { return 1700000000 }

	t.Cleanup(func() {
		presentOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
		presentRunOutputFn = func(ctx context.Context, args []string) ([]byte, error) {
			return tmux.RunOutput(ctx, args, tmux.RunOpts{})
		}
		presentSetWindowOptionsFn = func(ctx context.Context, windowID, server string, ops []tmux.WindowOptionOp) error {
			return tmux.SetWindowOptions(ctx, windowID, server, ops)
		}
		presentCreateWindowFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) error {
			return tmux.CreateWindowWithOptions(session, name, cwd, server, ops)
		}
		presentCreateWindowIDFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) (string, error) {
			return tmux.CreateWindowWithOptionsID(session, name, cwd, server, ops)
		}
		presentProbeFn = func(ctx context.Context, port int) error { return present.ProbePort(ctx, port) }
		presentNotifyFn = sendNotify
		presentNowFn = func() int64 { return time.Now().Unix() }
	})
	return f
}

// runPresentCmd drives `rk present <args...>` through the real cobra Execute()
// seam (the skill_test.go runSkill pattern) so arg/flag validation and exit
// classification run exactly as in production. Present's local flags and the
// root persistent --quiet are reset before and after so no state bleeds.
func runPresentCmd(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	resetPresentFlagState(t)
	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(append([]string{"present"}, args...))
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	err := rootCmd.Execute()
	return stdout.String(), stderr.String(), err
}

func resetPresentFlagState(t *testing.T) {
	t.Helper()
	reset := func() {
		for _, name := range []string{"window", "notify"} {
			if f := presentCmd.Flags().Lookup(name); f != nil {
				_ = presentCmd.Flags().Set(name, "")
				f.Changed = false
			}
		}
		presentWindowFlag, presentNotifyFlag = "", ""
		if f := rootCmd.PersistentFlags().Lookup("quiet"); f != nil {
			_ = rootCmd.PersistentFlags().Set("quiet", "false")
			f.Changed = false
		}
		quiet = false
	}
	reset()
	t.Cleanup(reset)
}

// opValue finds a set op (non-nil Value) by key.
func opValue(ops []tmux.WindowOptionOp, key string) (string, bool) {
	for _, op := range ops {
		if op.Key == key && op.Value != nil {
			return *op.Value, true
		}
	}
	return "", false
}

// opUnset reports whether ops carries an unset (nil-Value) op for key.
func opUnset(ops []tmux.WindowOptionOp, key string) bool {
	for _, op := range ops {
		if op.Key == key && op.Value == nil {
			return true
		}
	}
	return false
}

func TestPresentUsageErrorsExitTwo(t *testing.T) {
	installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")

	stdout, stderr, err := runPresentCmd(t) // no target
	if err == nil || exitCode(err) != exitUsage {
		t.Errorf("no target: err = %v (code %d), want usage exit 2", err, exitCode(err))
	}
	if stdout != "" {
		t.Errorf("no target wrote to stdout: %q", stdout)
	}
	if stderr == "" {
		t.Error("no target wrote nothing to stderr, want usage diagnostic")
	}

	if _, _, err := runPresentCmd(t, ":5173", "--bogus"); err == nil || exitCode(err) != exitUsage {
		t.Errorf("unknown flag: err = %v (code %d), want usage exit 2", err, exitCode(err))
	}
}

func TestPresentOutsideTmuxExitsOne(t *testing.T) {
	installPresentFakes(t)
	t.Setenv("TMUX_PANE", "") // not in a pane; no --window

	dir := t.TempDir()
	file := filepath.Join(dir, "mock.html")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, _, err := runPresentCmd(t, file)
	if err == nil || exitCode(err) != 1 {
		t.Errorf("err = %v (code %d), want operational exit 1", err, exitCode(err))
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on failure", stdout)
	}
}

func TestPresentUnreachablePortExitsOne(t *testing.T) {
	f := installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")
	presentProbeFn = func(_ context.Context, port int) error {
		f.probed = append(f.probed, port)
		return fmt.Errorf("nothing is listening on port %d (127.0.0.1): connection refused", port)
	}

	stdout, _, err := runPresentCmd(t, ":59999")
	if err == nil || exitCode(err) != 1 {
		t.Errorf("err = %v (code %d), want operational exit 1", err, exitCode(err))
	}
	if !strings.Contains(err.Error(), "59999") {
		t.Errorf("diagnostic %q does not name the unreachable port", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on failure", stdout)
	}
	if len(f.setOps) != 0 {
		t.Error("unreachable port still wrote window options")
	}
}

// TestPresentAttachComposition pins the default arm's option set per target
// kind: file/dir get @rk_url + @rk_present_root on the caller's OWN window;
// port/URL targets set @rk_url and UNSET @rk_present_root (clearing any stale
// serve root from a previous file/dir present), with no cache-buster. stdout
// carries exactly the URL.
func TestPresentAttachComposition(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "mock.html")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name      string
		arg       string
		wantURL   string
		wantRoot  string // "" = no root op expected
		wantProbe bool
	}{
		{"file", file, "/present/@7/mock.html?server=dev&v=1700000000", dir, false},
		{"dir", dir, "/present/@7/?server=dev&v=1700000000", dir, false},
		{"port", ":5173", "/proxy/5173/", "", true},
		{"local URL", "http://localhost:8080/docs?x=1", "/proxy/8080/docs?x=1", "", true},
		{"external URL", "https://staging.example.com/app", "https://staging.example.com/app", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := installPresentFakes(t)
			t.Setenv("TMUX_PANE", "%3")

			stdout, _, err := runPresentCmd(t, tc.arg)
			if err != nil {
				t.Fatalf("runPresent: %v", err)
			}
			if stdout != tc.wantURL+"\n" {
				t.Errorf("stdout = %q, want exactly %q", stdout, tc.wantURL+"\n")
			}
			if len(f.setOps) != 1 {
				t.Fatalf("SetWindowOptions calls = %d, want 1", len(f.setOps))
			}
			if f.setOpsWindow[0] != "@7" || f.setOpsServer[0] != "dev" {
				t.Errorf("attach target = (%q, %q), want (@7, dev)", f.setOpsWindow[0], f.setOpsServer[0])
			}
			ops := f.setOps[0]
			if u, ok := opValue(ops, presentURLOption); !ok || u != tc.wantURL {
				t.Errorf("@rk_url = %q (set=%v), want %q", u, ok, tc.wantURL)
			}
			root, hasRoot := opValue(ops, presentRootOption)
			if tc.wantRoot == "" {
				if hasRoot {
					t.Errorf("unexpected @rk_present_root = %q", root)
				}
				if !opUnset(ops, presentRootOption) {
					t.Error("non-file/dir target did not unset @rk_present_root — a stale serve root would survive")
				}
			}
			if tc.wantRoot != "" && (!hasRoot || root != tc.wantRoot) {
				t.Errorf("@rk_present_root = %q (set=%v), want %q", root, hasRoot, tc.wantRoot)
			}
			if _, hasType := opValue(ops, presentTypeOption); hasType {
				t.Error("attach arm touched @rk_type — must not steal the window's default view")
			}
			if tc.wantProbe && len(f.probed) == 0 {
				t.Error("expected a reachability probe, got none")
			}
			if !tc.wantProbe && len(f.probed) != 0 {
				t.Errorf("unexpected probes: %v", f.probed)
			}
			// URL targets carry no cache-buster.
			if tc.wantRoot == "" && strings.Contains(tc.wantURL, "v=") {
				t.Errorf("URL target %q carries a buster, want none", tc.wantURL)
			}
		})
	}
}

func TestPresentURLStillPrintsUnderQuiet(t *testing.T) {
	installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")

	stdout, _, err := runPresentCmd(t, "--quiet", ":5173")
	if err != nil {
		t.Fatalf("runPresent: %v", err)
	}
	if stdout != "/proxy/5173/\n" {
		t.Errorf("stdout = %q, want the URL even under --quiet (stdout is data)", stdout)
	}
}

func TestPresentNotifyDefaultMessage(t *testing.T) {
	f := installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")

	dir := t.TempDir()
	file := filepath.Join(dir, "mock.html")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, _, err := runPresentCmd(t, "--notify", file); err != nil {
		t.Fatalf("runPresent --notify: %v", err)
	}
	if len(f.notified) != 1 || f.notified[0] != "presenting mock.html" {
		t.Errorf("notified = %v, want [presenting mock.html]", f.notified)
	}

	resetPresentFlagState(t)
	if _, _, err := runPresentCmd(t, file, "--notify=look at this"); err != nil {
		t.Fatalf("runPresent --notify=msg: %v", err)
	}
	if len(f.notified) != 2 || f.notified[1] != "look at this" {
		t.Errorf("notified = %v, want second message \"look at this\"", f.notified)
	}

	// Without the flag, nothing is sent.
	resetPresentFlagState(t)
	if _, _, err := runPresentCmd(t, file); err != nil {
		t.Fatalf("runPresent: %v", err)
	}
	if len(f.notified) != 2 {
		t.Errorf("notify sent without the flag: %v", f.notified)
	}
}

func TestPresentWindowExternalURL(t *testing.T) {
	f := installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")

	stdout, _, err := runPresentCmd(t, "--window", "https://staging.example.com")
	if err != nil {
		t.Fatalf("runPresent --window: %v", err)
	}
	if stdout != "https://staging.example.com\n" {
		t.Errorf("stdout = %q, want the verbatim URL", stdout)
	}
	if len(f.created) != 1 {
		t.Fatalf("CreateWindowWithOptions calls = %d, want 1", len(f.created))
	}
	c := f.created[0]
	if c.session != "work" || c.server != "dev" {
		t.Errorf("created in (%q, %q), want (work, dev)", c.session, c.server)
	}
	if c.name != "staging-example-com" {
		t.Errorf("window name = %q, want sanitized host staging-example-com", c.name)
	}
	if tp, ok := opValue(c.ops, presentTypeOption); !ok || tp != "iframe" {
		t.Errorf("@rk_type = %q (set=%v), want iframe", tp, ok)
	}
	if u, ok := opValue(c.ops, presentURLOption); !ok || u != "https://staging.example.com" {
		t.Errorf("@rk_url = %q (set=%v), want the verbatim URL", u, ok)
	}
}

// TestPresentWindowFileTwoStep pins the file/dir --window flow: the /present/
// URL embeds the NEW window's id, so creation sets @rk_type alone and the
// id-dependent options land in a follow-up batch on the returned id.
func TestPresentWindowFileTwoStep(t *testing.T) {
	f := installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")

	dir := t.TempDir()
	file := filepath.Join(dir, "mock.report.html")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, _, err := runPresentCmd(t, "--window", file)
	if err != nil {
		t.Fatalf("runPresent --window file: %v", err)
	}
	wantURL := "/present/@42/mock.report.html?server=dev&v=1700000000"
	if stdout != wantURL+"\n" {
		t.Errorf("stdout = %q, want %q (new window's id in the URL)", stdout, wantURL)
	}
	if len(f.createdID) != 1 {
		t.Fatalf("CreateWindowWithOptionsID calls = %d, want 1", len(f.createdID))
	}
	c := f.createdID[0]
	if c.name != "mock-report-html" {
		t.Errorf("window name = %q, want mock-report-html (periods sanitized)", c.name)
	}
	if len(c.ops) != 1 {
		t.Errorf("creation ops = %+v, want @rk_type alone (URL needs the new id)", c.ops)
	}
	if len(f.setOps) != 1 || f.setOpsWindow[0] != "@42" {
		t.Fatalf("follow-up option set = windows %v, want [@42]", f.setOpsWindow)
	}
	if u, _ := opValue(f.setOps[0], presentURLOption); u != wantURL {
		t.Errorf("@rk_url = %q, want %q", u, wantURL)
	}
	if root, ok := opValue(f.setOps[0], presentRootOption); !ok || root != dir {
		t.Errorf("@rk_present_root = %q (set=%v), want %q", root, ok, dir)
	}
}

func TestPresentWindowExplicitNameAndOutsideTmux(t *testing.T) {
	installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")

	if _, _, err := runPresentCmd(t, "--window=my mock", ":5173"); err == nil {
		t.Fatal("--window with a space in the explicit name: err = nil, want ValidateNewName rejection")
	}
}
