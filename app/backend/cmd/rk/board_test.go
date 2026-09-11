package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// boardHandler records the last request the test daemon received and replies
// with the canned status/body. hit stays false when a usage-class failure
// short-circuits before any request — the no-HTTP-on-usage assertion.
type boardHandler struct {
	hit      bool
	method   string
	path     string
	body     map[string]any
	status   int
	response string
}

func (h *boardHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.hit = true
	h.method = r.Method
	h.path = r.URL.Path
	data, _ := io.ReadAll(r.Body)
	if len(data) > 0 {
		_ = json.Unmarshal(data, &h.body)
	}
	status := h.status
	if status == 0 {
		status = http.StatusOK
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(h.response))
}

// withBoardDaemon starts an httptest daemon and points the origin at it. The
// own-tab seam is stubbed to "not in tmux" so server resolution lands on
// "default" deterministically regardless of the test runner's environment.
func withBoardDaemon(t *testing.T, h *boardHandler) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	pointConfigAt(t, srv.URL)
	orig := ownTabOriginalTMUXFn
	ownTabOriginalTMUXFn = func() string { return "" }
	t.Cleanup(func() { ownTabOriginalTMUXFn = orig })
}

// runBoardCmd drives `rk board <args...>` through the real cobra Execute()
// seam (the runTabCmd pattern) so arg/flag validation and exit classification
// run exactly as in production.
func runBoardCmd(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	resetBoardFlagState(t)
	var stdout, stderr strings.Builder
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(append([]string{"board"}, args...))
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	err := rootCmd.Execute()
	return stdout.String(), stderr.String(), err
}

// resetBoardFlagState clears the family's persistent flag values and Changed
// markers so one Execute() run never bleeds into the next (the
// resetTabFlagState idiom).
func resetBoardFlagState(t *testing.T) {
	t.Helper()
	reset := func() {
		resetFlagChanged(boardCmd, "server", "json", "before", "after")
		boardServerFlag, boardBeforeFlag, boardAfterFlag = "", "", ""
		boardJSONFlag = false
	}
	reset()
	t.Cleanup(reset)
}

func TestBoardRegisteredAfterTab(t *testing.T) {
	// Cobra sorts Commands() by name, so registration order is not observable
	// here; "after tab" lives in root.go's init. Assert the family shape.
	var found *cobra.Command
	for _, cmd := range rootCmd.Commands() {
		if cmd.Name() == "board" {
			found = cmd
			break
		}
	}
	if found == nil {
		t.Fatal("expected 'board' to be registered on rootCmd")
	}
	for _, name := range []string{"show", "pin", "unpin", "reorder"} {
		c, _, err := found.Find([]string{name})
		if err != nil || c == nil || c.Name() != name {
			t.Errorf("board child %q not found (err=%v)", name, err)
		}
	}
	// The four persistent flags the MCP row relies on (schema.go's lookupFlag
	// checks local then inherited — they must be local-persistent on board).
	for _, flag := range []string{"server", "json", "before", "after"} {
		if found.PersistentFlags().Lookup(flag) == nil {
			t.Errorf("board missing persistent flag %q", flag)
		}
	}
}

// TestBoardUsageArgCounts proves every child's Args validator is
// usageArgs-wrapped (exit 2) and no request is made.
func TestBoardUsageArgCounts(t *testing.T) {
	h := &boardHandler{response: `[]`}
	withBoardDaemon(t, h)

	cases := [][]string{
		{"show", "a", "b"},
		{"pin", "work"},
		{"unpin", "work"},
		{"reorder", "work"},
		{"pin", "work", "@7", "extra"},
	}
	for _, args := range cases {
		if _, _, err := runBoardCmd(t, args...); err == nil || exitCode(err) != exitUsage {
			t.Errorf("board %v: err = %v (code %d), want exit 2", args, err, exitCode(err))
		}
	}
	if h.hit {
		t.Error("an arg-count violation must not reach the daemon")
	}
}

func TestBoardShowList(t *testing.T) {
	h := &boardHandler{response: `[{"name":"work","pinCount":3},{"name":"ops","pinCount":1}]`}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "show")
	if err != nil {
		t.Fatalf("show: %v", err)
	}
	if h.method != http.MethodGet || h.path != "/api/boards" {
		t.Errorf("request = %s %s, want GET /api/boards", h.method, h.path)
	}
	lines := strings.Split(strings.TrimRight(stdout, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("stdout = %q, want 2 rows", stdout)
	}
	if f := strings.Fields(lines[0]); len(f) != 2 || f[0] != "work" || f[1] != "3" {
		t.Errorf("row 1 = %q, want work <tab> 3 (tabwriter-aligned)", lines[0])
	}
	if f := strings.Fields(lines[1]); len(f) != 2 || f[0] != "ops" || f[1] != "1" {
		t.Errorf("row 2 = %q", lines[1])
	}
}

func TestBoardShowListJSONPassThrough(t *testing.T) {
	body := `[ { "name": "work", "pinCount": 3, "futureField": true } ]`
	h := &boardHandler{response: body}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "show", "--json")
	if err != nil {
		t.Fatalf("show --json: %v", err)
	}
	var got []map[string]any
	unwrapEnvelopeResult(t, stdout, &got)
	if len(got) != 1 || got[0]["name"] != "work" || got[0]["pinCount"] != float64(3) || got[0]["futureField"] != true {
		t.Errorf("result = %v, want the route body's keys passed through undecoded (incl. futureField)", got)
	}
}

func TestBoardShowEntries(t *testing.T) {
	h := &boardHandler{response: `[{"server":"default","windowId":"@7","session":"_rk-pin-7","windowIndex":1,"windowName":"agent","orderKey":"m","panes":[{},{}]}]`}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "show", "work")
	if err != nil {
		t.Fatalf("show work: %v", err)
	}
	if h.path != "/api/boards/work" {
		t.Errorf("path = %q, want /api/boards/work", h.path)
	}
	f := strings.Fields(strings.TrimSpace(stdout))
	want := []string{"@7", "default", "_rk-pin-7", "1", "agent", "2"}
	if len(f) != len(want) {
		t.Fatalf("stdout = %q, want %d columns", stdout, len(want))
	}
	for i := range want {
		if f[i] != want[i] {
			t.Errorf("column %d = %q, want %q (stdout %q)", i, f[i], want[i], stdout)
		}
	}
}

func TestBoardShowEmpty(t *testing.T) {
	h := &boardHandler{response: `[]`}
	withBoardDaemon(t, h)

	for _, args := range [][]string{{"show"}, {"show", "work"}} {
		stdout, _, err := runBoardCmd(t, args...)
		if err != nil || stdout != "" {
			t.Errorf("board %v on an empty list: stdout = %q, err = %v, want empty output exit 0", args, stdout, err)
		}
	}
}

func TestBoardShowAcceptsAndIgnoresServerFlag(t *testing.T) {
	h := &boardHandler{response: `[]`}
	withBoardDaemon(t, h)

	if _, _, err := runBoardCmd(t, "show", "-L", "anything"); err != nil {
		t.Errorf("show -L anything: %v, want accepted (the flag is ignored)", err)
	}
}

func TestBoardPin(t *testing.T) {
	h := &boardHandler{status: http.StatusCreated, response: `{"ok":true}`}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "pin", "work", "@7")
	if err != nil {
		t.Fatalf("pin: %v", err)
	}
	if h.method != http.MethodPost || h.path != "/api/boards/work/pin" {
		t.Errorf("request = %s %s, want POST /api/boards/work/pin", h.method, h.path)
	}
	if h.body["server"] != "default" || h.body["windowId"] != "@7" {
		t.Errorf("body = %v, want server=default windowId=@7", h.body)
	}
	if stdout != "pinned @7 to work\n" {
		t.Errorf("stdout = %q, want %q", stdout, "pinned @7 to work\n")
	}
}

func TestBoardPinJSONReceipt(t *testing.T) {
	h := &boardHandler{status: http.StatusCreated, response: `{"ok":true}`}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "pin", "work", "@7", "--json")
	if err != nil {
		t.Fatalf("pin --json: %v", err)
	}
	var got map[string]string
	unwrapEnvelopeResult(t, stdout, &got)
	if len(got) != 2 || got["board"] != "work" || got["window"] != "@7" {
		t.Errorf("result = %v, want {board:work window:@7}", got)
	}
}

func TestBoardPinServerFlag(t *testing.T) {
	h := &boardHandler{status: http.StatusCreated, response: `{"ok":true}`}
	withBoardDaemon(t, h)

	if _, _, err := runBoardCmd(t, "pin", "work", "@7", "-L", "rk-test"); err != nil {
		t.Fatalf("pin -L: %v", err)
	}
	if h.body["server"] != "rk-test" {
		t.Errorf("body server = %v, want rk-test", h.body["server"])
	}
}

func TestBoardUnpin(t *testing.T) {
	h := &boardHandler{response: `{"ok":true}`}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "unpin", "work", "@7")
	if err != nil {
		t.Fatalf("unpin: %v", err)
	}
	if h.path != "/api/boards/work/unpin" {
		t.Errorf("path = %q, want /api/boards/work/unpin", h.path)
	}
	if h.body["server"] != "default" || h.body["windowId"] != "@7" {
		t.Errorf("body = %v", h.body)
	}
	if stdout != "unpinned @7 from work\n" {
		t.Errorf("stdout = %q", stdout)
	}

	stdout, _, err = runBoardCmd(t, "unpin", "work", "@7", "--json")
	if err != nil {
		t.Fatalf("unpin --json: %v", err)
	}
	var got map[string]string
	unwrapEnvelopeResult(t, stdout, &got)
	if len(got) != 2 || got["board"] != "work" || got["window"] != "@7" {
		t.Errorf("result = %v, want {board:work window:@7}", got)
	}
}

func TestBoardReorderNeighbours(t *testing.T) {
	h := &boardHandler{response: `{"ok":true,"newOrderKey":"a0V"}`}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "reorder", "work", "@7", "--before", "@3")
	if err != nil {
		t.Fatalf("reorder --before: %v", err)
	}
	if h.path != "/api/boards/work/reorder" {
		t.Errorf("path = %q", h.path)
	}
	if h.body["before"] != "@3" {
		t.Errorf("before = %v, want @3", h.body["before"])
	}
	if v, present := h.body["after"]; !present || v != nil {
		t.Errorf("after = %v (present %v), want JSON null", v, present)
	}
	if stdout != "reordered @7 on work → a0V\n" {
		t.Errorf("stdout = %q", stdout)
	}

	stdout, _, err = runBoardCmd(t, "reorder", "work", "@7", "--after", "@9", "--json")
	if err != nil {
		t.Fatalf("reorder --after --json: %v", err)
	}
	if h.body["after"] != "@9" {
		t.Errorf("after = %v, want @9", h.body["after"])
	}
	if v, present := h.body["before"]; !present || v != nil {
		t.Errorf("before = %v (present %v), want JSON null", v, present)
	}
	var reorderGot map[string]string
	unwrapEnvelopeResult(t, stdout, &reorderGot)
	if len(reorderGot) != 3 || reorderGot["board"] != "work" || reorderGot["window"] != "@7" || reorderGot["orderKey"] != "a0V" {
		t.Errorf("result = %v, want {board:work window:@7 orderKey:a0V}", reorderGot)
	}

	// Neither neighbour means append: both null.
	if _, _, err := runBoardCmd(t, "reorder", "work", "@7"); err != nil {
		t.Fatalf("reorder append: %v", err)
	}
	for _, k := range []string{"before", "after"} {
		if v, present := h.body[k]; !present || v != nil {
			t.Errorf("%s = %v (present %v), want JSON null", k, v, present)
		}
	}
}

func TestBoardUnreachableDaemon(t *testing.T) {
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", "1") // nothing listens — connection refused

	stdout, stderr, err := runBoardCmd(t, "show")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v (code %d), want exit 1", err, exitCode(err))
	}
	if !strings.Contains(err.Error(), "unreachable at http://127.0.0.1:1") || !strings.Contains(err.Error(), "rk serve") {
		t.Errorf("err = %v, want the origin and rk serve named", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on failure", stdout)
	}
	if !strings.Contains(stderr, "unreachable") {
		t.Errorf("stderr = %q, want the unreachable message", stderr)
	}
}

func TestBoardDaemonErrorPassesThrough(t *testing.T) {
	h := &boardHandler{status: http.StatusNotFound, response: `{"error":"window not found on server"}`}
	withBoardDaemon(t, h)

	stdout, _, err := runBoardCmd(t, "pin", "work", "@7")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v (code %d), want exit 1", err, exitCode(err))
	}
	if err.Error() != "window not found on server" {
		t.Errorf("err = %v, want the body's error string verbatim", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty on failure", stdout)
	}
}

func TestBoardDaemonErrorFallback(t *testing.T) {
	h := &boardHandler{status: http.StatusInternalServerError, response: `{"nope":true}`}
	withBoardDaemon(t, h)

	_, _, err := runBoardCmd(t, "pin", "work", "@7")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v (code %d), want exit 1", err, exitCode(err))
	}
	if !strings.Contains(err.Error(), "board: POST /api/boards/work/pin returned 500") {
		t.Errorf("err = %v, want the status-named fallback", err)
	}
}

// TestBoardUsageErrorsMakeNoRequest: every CLI-side validation failure is
// exit 2 before any HTTP call.
func TestBoardUsageErrorsMakeNoRequest(t *testing.T) {
	h := &boardHandler{status: http.StatusCreated, response: `{"ok":true}`}
	withBoardDaemon(t, h)

	cases := []struct {
		name string
		args []string
		want string
	}{
		{"bad board name on pin", []string{"pin", "bad/name", "@7"}, "invalid board name"},
		{"bad board name on show", []string{"show", "bad/name"}, "invalid board name"},
		{"malformed window id", []string{"pin", "work", "@x"}, "invalid tab address"},
		{"--before off reorder", []string{"pin", "work", "@7", "--before", "@3"}, "--before/--after apply to reorder only"},
		{"--after on show", []string{"show", "--after", "@3"}, "--before/--after apply to reorder only"},
		{"non-@N neighbour", []string{"reorder", "work", "@7", "--before", "=s:w"}, "invalid --before window id"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h.hit = false
			stdout, _, err := runBoardCmd(t, tc.args...)
			if err == nil || exitCode(err) != exitUsage {
				t.Fatalf("err = %v (code %d), want exit 2", err, exitCode(err))
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to name %q", err, tc.want)
			}
			if stdout != "" {
				t.Errorf("stdout = %q, want empty on failure", stdout)
			}
			if h.hit {
				t.Error("a usage error must not reach the daemon")
			}
		})
	}
}
