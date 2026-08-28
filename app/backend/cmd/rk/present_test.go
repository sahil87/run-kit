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
	displayArgs [][]string
	webAdds     []presentWebAdd
	family      tmux.WebTabFamily
	createdID   []presentCreatedID
	notified    []string
	probed      []int
}

type presentWebAdd struct {
	windowID, server, url, root string
	index                       int
	existed                     bool
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
	// The fake WebAdd honors the contract the production tmux.WebAdd owns: the
	// slot is len(family)+1 on a fresh append (an empty family lands slot 1 and
	// arms _active), and an identical stored URL is an idempotent hit on its
	// existing slot. Tests assert the (windowID, server, url, root) it was
	// driven with — the invariants themselves are tmux.WebAdd's (webtabs_test).
	presentWebAddFn = func(_ context.Context, windowID, server, url, root string) (int, bool, error) {
		for i, tab := range f.family.Tabs {
			if tab == url {
				f.webAdds = append(f.webAdds, presentWebAdd{windowID, server, url, root, i + 1, true})
				return i + 1, true, nil
			}
		}
		n := len(f.family.Tabs) + 1
		f.webAdds = append(f.webAdds, presentWebAdd{windowID, server, url, root, n, false})
		return n, false, nil
	}
	presentReadFamilyFn = func(_ context.Context, windowID, server string) (tmux.WebTabFamily, error) {
		return f.family, nil
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
		presentWebAddFn = func(ctx context.Context, windowID, server, url, root string) (int, bool, error) {
			return tmux.WebAdd(ctx, windowID, server, url, root)
		}
		presentReadFamilyFn = func(ctx context.Context, windowID, server string) (tmux.WebTabFamily, error) {
			return tmux.ReadWebTabFamily(ctx, windowID, server)
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
	if len(f.webAdds) != 0 {
		t.Error("unreachable port still added a web tab")
	}
}

// TestPresentAttachComposition pins the default arm's WebAdd call per target
// kind: file/dir targets pass the slot URL + the serve root; port/URL targets
// pass root "" (WebAdd clears any stale serve root from a previous file/dir
// present). stdout carries exactly the URL of the slot WebAdd returned. The
// family invariants (_active arming, dense append, ?v= refresh) are
// tmux.WebAdd's, pinned in webtabs_test — here only the arm's contract.
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
		wantRoot  string // "" = root cleared (non-file/dir kind)
		wantProbe bool
	}{
		{"file", file, "/present/@7/1/mock.html?server=dev&v=1700000000", dir, false},
		{"dir", dir, "/present/@7/1/?server=dev&v=1700000000", dir, false},
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
			if len(f.webAdds) != 1 {
				t.Fatalf("WebAdd calls = %d, want 1", len(f.webAdds))
			}
			add := f.webAdds[0]
			if add.windowID != "@7" || add.server != "dev" {
				t.Errorf("attach target = (%q, %q), want (@7, dev)", add.windowID, add.server)
			}
			if add.url != tc.wantURL {
				t.Errorf("WebAdd url = %q, want %q", add.url, tc.wantURL)
			}
			if add.root != tc.wantRoot {
				t.Errorf("WebAdd root = %q, want %q", add.root, tc.wantRoot)
			}
			// Empty family ⇒ the fresh append lands slot 1 (and production
			// WebAdd arms _active=1 — its own invariant).
			if add.index != 1 || add.existed {
				t.Errorf("WebAdd returned (index=%d, existed=%v), want (1, false)", add.index, add.existed)
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

// TestPresentAttachNonEmptyFamily pins the dense-append contract: on a window
// already holding two tabs the default arm appends at slot 3 (it never evicts
// tab 1), and the printed URL carries the new slot.
func TestPresentAttachNonEmptyFamily(t *testing.T) {
	f := installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")
	f.family = tmux.WebTabFamily{Tabs: []string{"/proxy/3000/", "/proxy/3001/"}, Active: 1}

	stdout, _, err := runPresentCmd(t, ":5173")
	if err != nil {
		t.Fatalf("runPresent: %v", err)
	}
	if stdout != "/proxy/5173/\n" {
		t.Errorf("stdout = %q, want /proxy/5173/", stdout)
	}
	if len(f.webAdds) != 1 || f.webAdds[0].index != 3 || f.webAdds[0].existed {
		t.Errorf("WebAdd = %+v, want one call landing slot 3 (dense append, tab 1 untouched)", f.webAdds)
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
	if len(f.createdID) != 1 {
		t.Fatalf("CreateWindowWithOptionsID calls = %d, want 1", len(f.createdID))
	}
	c := f.createdID[0]
	if c.session != "work" || c.server != "dev" {
		t.Errorf("created in (%q, %q), want (work, dev)", c.session, c.server)
	}
	if c.name != "staging-example-com" {
		t.Errorf("window name = %q, want sanitized host staging-example-com", c.name)
	}
	// Creation carries the layout alone; the URL lands via WebAdd on the new
	// window's empty family (slot 1 + _active=1, WebAdd's invariant).
	if tp, ok := opValue(c.ops, tmux.LayoutOption); !ok || tp != "single:web" {
		t.Errorf("@rk_win_layout = %q (set=%v), want single:web", tp, ok)
	}
	if len(c.ops) != 1 {
		t.Errorf("creation ops = %+v, want @rk_win_layout alone (the URL follows via WebAdd)", c.ops)
	}
	if len(f.webAdds) != 1 {
		t.Fatalf("WebAdd calls = %d, want 1", len(f.webAdds))
	}
	if f.webAdds[0].url != "https://staging.example.com" {
		t.Errorf("WebAdd url = %q, want the verbatim URL", f.webAdds[0].url)
	}
	if f.webAdds[0].windowID != "@42" {
		t.Errorf("WebAdd window = %q, want @42 (the id creation returned — never a session:name re-resolution)", f.webAdds[0].windowID)
	}
	if f.webAdds[0].index != 1 || f.webAdds[0].existed {
		t.Errorf("WebAdd returned (index=%d, existed=%v), want (1, false)", f.webAdds[0].index, f.webAdds[0].existed)
	}
}

// TestPresentWindowFileTwoStep pins the file/dir --window flow: the /present/
// URL embeds the NEW window's id, so creation sets @rk_win_layout alone and
// WebAdd adds the id-addressed URL + serve root on the returned id's empty
// family (slot 1).
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
	wantURL := "/present/@42/1/mock.report.html?server=dev&v=1700000000"
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
		t.Errorf("creation ops = %+v, want @rk_win_layout alone (URL needs the new id)", c.ops)
	}
	if len(f.webAdds) != 1 {
		t.Fatalf("WebAdd calls = %d, want 1", len(f.webAdds))
	}
	add := f.webAdds[0]
	if add.windowID != "@42" {
		t.Errorf("WebAdd window = %q, want @42 (the new window)", add.windowID)
	}
	if add.url != wantURL {
		t.Errorf("WebAdd url = %q, want %q", add.url, wantURL)
	}
	if add.root != dir {
		t.Errorf("WebAdd root = %q, want %q", add.root, dir)
	}
	if add.index != 1 || add.existed {
		t.Errorf("WebAdd returned (index=%d, existed=%v), want (1, false)", add.index, add.existed)
	}
}

func TestPresentWindowExplicitNameAndOutsideTmux(t *testing.T) {
	installPresentFakes(t)
	t.Setenv("TMUX_PANE", "%3")

	if _, _, err := runPresentCmd(t, "--window=my mock", ":5173"); err == nil {
		t.Fatal("--window with a space in the explicit name: err = nil, want ValidateNewName rejection")
	}
}
