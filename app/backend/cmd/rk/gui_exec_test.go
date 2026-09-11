package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// withGuiExecSeams points the exec verb's seams at capturing stubs and
// restores them on cleanup; the returned recorders hold the exec/start calls.
func withGuiExecSeams(t *testing.T) (execCalls *[][]string, startCalls *[][]string) {
	t.Helper()
	execCalls, startCalls = new([][]string), new([][]string)

	origLookPath, origExec, origStart := guiExecLookPathFn, guiExecFn, guiExecStartFn
	origGOOS := guiGOOS
	t.Cleanup(func() {
		guiExecLookPathFn, guiExecFn, guiExecStartFn = origLookPath, origExec, origStart
		guiGOOS = origGOOS
	})

	guiExecLookPathFn = func(name string) (string, error) { return "/usr/bin/" + name, nil }
	guiExecFn = func(argv0 string, argv []string, env []string) error {
		*execCalls = append(*execCalls, append([]string{argv0}, append(argv, env...)...))
		return nil
	}
	guiExecStartFn = func(argv []string, env []string) (int, error) {
		*startCalls = append(*startCalls, append(argv, env...))
		return 4321, nil
	}
	guiGOOS = "linux"
	return execCalls, startCalls
}

// execCmdWith builds a bare command carrying the exec verb's --detach flag.
func execCmdWith(out, errOut *bytes.Buffer, detach bool) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().BoolP("detach", "d", false, "")
	if detach {
		_ = cmd.Flags().Set("detach", "true")
	}
	return cmd
}

func TestGuiExecOffRefuses(t *testing.T) {
	execCalls, startCalls := withGuiExecSeams(t)
	withGuiCLISeams(t)

	err := runGuiExec(execCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false), []string{"xterm"})
	if err == nil || err.Error() != guiErrOff {
		t.Errorf("err = %v, want the off refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*execCalls) != 0 || len(*startCalls) != 0 {
		t.Errorf("exec/start called %d/%d times while off — no process may start", len(*execCalls), len(*startCalls))
	}
}

func TestGuiExecNotRunningRefuses(t *testing.T) {
	execCalls, _ := withGuiExecSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiProbeFn = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reason: "not running"}, nil
	}

	err := runGuiExec(execCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false), []string{"xterm"})
	if err == nil || err.Error() != guiErrNotRunning {
		t.Errorf("err = %v, want the not-running refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*execCalls) != 0 {
		t.Errorf("exec seam called %d times while not running", len(*execCalls))
	}
}

func TestGuiExecDarwinRefusesBeforeStatusRead(t *testing.T) {
	execCalls, _ := withGuiExecSeams(t)
	guiGOOS = "darwin"
	guiDaemonRunningFn = func() bool {
		t.Error("status seams consulted on darwin — the OS refusal must fire first")
		return false
	}

	err := runGuiExec(execCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false), []string{"xterm"})
	if err == nil || err.Error() != "gui exec is not supported on macOS in v1 — the GUI mirrors your live session view-only" {
		t.Errorf("err = %v, want the macOS refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*execCalls) != 0 {
		t.Errorf("exec seam called %d times on darwin", len(*execCalls))
	}
}

func TestGuiExecEnvDedupesAndOverrides(t *testing.T) {
	base := []string{"HOME=/home/u", "DISPLAY=:0", "RK_GUI_SOCKET=/old.sock", "PATH=/usr/bin"}
	env := guiExecEnv(base, ":10", "/s/host.sock")

	var displays, sockets int
	for _, kv := range env {
		switch {
		case kv == "DISPLAY=:10":
			displays++
		case strings.HasPrefix(kv, "DISPLAY="):
			t.Errorf("stale DISPLAY entry survived: %q", kv)
		case kv == "RK_GUI_SOCKET=/s/host.sock":
			sockets++
		case strings.HasPrefix(kv, "RK_GUI_SOCKET="):
			t.Errorf("stale RK_GUI_SOCKET entry survived: %q", kv)
		}
	}
	if displays != 1 || sockets != 1 {
		t.Errorf("env carries DISPLAY ×%d, RK_GUI_SOCKET ×%d, want exactly one each: %v", displays, sockets, env)
	}
	for _, want := range []string{"HOME=/home/u", "PATH=/usr/bin"} {
		found := false
		for _, kv := range env {
			if kv == want {
				found = true
			}
		}
		if !found {
			t.Errorf("env lost caller variable %q: %v", want, env)
		}
	}
}

func TestGuiExecForegroundPassthrough(t *testing.T) {
	execCalls, startCalls := withGuiExecSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	t.Setenv("DISPLAY", ":0")

	if err := runGuiExec(execCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false), []string{"xdotool", "-v"}); err != nil {
		t.Fatal(err)
	}
	if len(*execCalls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(*execCalls))
	}
	call := (*execCalls)[0]
	if call[0] != "/usr/bin/xdotool" {
		t.Errorf("exec path = %q, want the LookPath-resolved /usr/bin/xdotool", call[0])
	}
	if call[1] != "xdotool" || call[2] != "-v" {
		t.Errorf("exec argv = %v, want [xdotool -v] (the caller's argv verbatim)", call[1:3])
	}
	var displays int
	for _, kv := range call[3:] {
		if kv == "DISPLAY=:10" {
			displays++
		}
	}
	if displays != 1 {
		t.Errorf("exec env carries DISPLAY=:10 ×%d, want exactly one (the caller's DISPLAY=:0 overridden): %v", displays, call[3:])
	}
	if len(*startCalls) != 0 {
		t.Errorf("start seam called %d times on the foreground path", len(*startCalls))
	}
}

func TestGuiExecNotFoundOnPath(t *testing.T) {
	execCalls, _ := withGuiExecSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiExecLookPathFn = func(string) (string, error) { return "", errors.New("exec: no such file") }

	err := runGuiExec(execCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false), []string{"nosuchprog"})
	if err == nil || err.Error() != "error: nosuchprog: not found on PATH" {
		t.Errorf("err = %v, want the not-found error", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*execCalls) != 0 {
		t.Errorf("exec seam called %d times after a LookPath failure", len(*execCalls))
	}
}

func TestGuiExecDetachStartsSession(t *testing.T) {
	execCalls, startCalls := withGuiExecSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out bytes.Buffer
	err := runGuiExec(execCmdWith(&out, &bytes.Buffer{}, true), []string{"chromium", "https://example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if len(*startCalls) != 1 {
		t.Fatalf("start calls = %d, want 1", len(*startCalls))
	}
	call := (*startCalls)[0]
	if call[0] != "chromium" || call[1] != "https://example.com" {
		t.Errorf("start argv = %v, want [chromium https://example.com]", call[:2])
	}
	foundDisplay := false
	for _, kv := range call[2:] {
		if kv == "DISPLAY=:10" {
			foundDisplay = true
		}
	}
	if !foundDisplay {
		t.Errorf("start env lacks DISPLAY=:10: %v", call[2:])
	}
	if got, want := out.String(), "started 4321 on :10\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
	if len(*execCalls) != 0 {
		t.Errorf("exec seam called %d times on the --detach path", len(*execCalls))
	}
}

func TestGuiExecDetachStartFailure(t *testing.T) {
	_, _ = withGuiExecSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiExecStartFn = func([]string, []string) (int, error) { return 0, errors.New("fork/exec: permission denied") }

	err := runGuiExec(execCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, true), []string{"chromium"})
	if err == nil || !strings.Contains(err.Error(), "error: chromium: fork/exec: permission denied") {
		t.Errorf("err = %v, want error: <cmd>: <reason>", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

// TestGuiExecRegisteredOnGuiTree covers exec's place in the family (the
// TestGuiTreeRegistered style): a Long block is mandatory, and a missing
// command word is a usage-class failure (exit 2) via the usageArgs wrap.
func TestGuiExecRegisteredOnGuiTree(t *testing.T) {
	var execCmd *cobra.Command
	for _, c := range guiCmd.Commands() {
		if c.Name() == "exec" {
			execCmd = c
		}
	}
	if execCmd == nil {
		t.Fatal("exec is not registered on the gui family")
	}
	if execCmd.Long == "" {
		t.Error("exec has no Long block")
	}
	if err := execCmd.Args(execCmd, nil); exitCode(err) != exitUsage {
		t.Errorf("missing command word exit code = %d, want %d (usage)", exitCode(err), exitUsage)
	}
}

// TestGuiExecDetachRealStartArgv pins the default start seam's contract
// without starting a real GUI app: `true` must start, return a live pid, and
// run as its own session leader.
func TestGuiExecDetachRealStartArgv(t *testing.T) {
	truePath, err := guiExecLookPathFn("true")
	if err != nil {
		t.Skip("no `true` on PATH")
	}
	pid, err := guiExecStartDetached([]string{truePath}, os.Environ())
	if err != nil {
		t.Fatalf("start detached true: %v", err)
	}
	if pid <= 0 {
		t.Errorf("pid = %d, want a real pid", pid)
	}
}

// execCmdWithJSON builds a bare command carrying the exec verb's --detach and
// --json flags.
func execCmdWithJSON(out, errOut *bytes.Buffer, detach, jsonOut bool) *cobra.Command {
	cmd := execCmdWith(out, errOut, detach)
	cmd.Flags().Bool("json", false, "")
	if jsonOut {
		_ = cmd.Flags().Set("json", "true")
	}
	return cmd
}

// TestGuiExecDetachJSONReceipt: --detach --json prints exactly one envelope
// document carrying the started pid and display; the exec seam never runs.
func TestGuiExecDetachJSONReceipt(t *testing.T) {
	execCalls, startCalls := withGuiExecSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	record := guiExecStartFn
	guiExecStartFn = func(argv []string, env []string) (int, error) {
		if _, err := record(argv, env); err != nil {
			return 0, err
		}
		return 4242, nil
	}

	var out bytes.Buffer
	err := runGuiExec(execCmdWithJSON(&out, &bytes.Buffer{}, true, true), []string{"xterm", "-e", "top"})
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		OK     bool `json:"ok"`
		Result struct {
			PID     int    `json:"pid"`
			Display string `json:"display"`
		} `json:"result"`
	}
	if err := json.Unmarshal(out.Bytes(), &doc); err != nil || strings.Count(out.String(), "\n") != strings.Count(strings.TrimRight(out.String(), "\n"), "\n")+1 {
		t.Fatalf("stdout is not one JSON document: %v\n%s", err, out.String())
	}
	if !doc.OK || doc.Result.PID != 4242 || doc.Result.Display != ":10" {
		t.Errorf("envelope = %+v, want ok with pid 4242 on :10", doc)
	}
	if len(*startCalls) != 1 || len(*execCalls) != 0 {
		t.Errorf("start/exec calls = %d/%d, want 1/0", len(*startCalls), len(*execCalls))
	}
}

// TestGuiExecJSONWithoutDetach: --json without --detach is a usage error
// raised before the OS and reachability gates — the status seams are never
// consulted — and the failure envelope is execute()'s central writer's, not the RunE's.
func TestGuiExecJSONWithoutDetach(t *testing.T) {
	execCalls, startCalls := withGuiExecSeams(t)
	guiDaemonRunningFn = func() bool {
		t.Error("status seams consulted before the flag gate — usage errors come first")
		return false
	}

	var out bytes.Buffer
	c := execCmdWithJSON(&out, &bytes.Buffer{}, false, true)
	err := runGuiExec(c, []string{"xterm"})
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("err = %v (code %d), want an exit-2 usage error", err, exitCode(err))
	}
	// The failure envelope is execute()'s central writer's job; the RunE
	// itself writes nothing to stdout.
	if out.Len() != 0 {
		t.Errorf("RunE wrote %q to stdout on the usage refusal, want nothing", out.String())
	}
	if !jsonErrorEnvelope(c, err) {
		t.Fatal("jsonErrorEnvelope declined to write for a --json usage error")
	}
	var doc struct {
		OK    bool `json:"ok"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(out.Bytes(), &doc); err != nil {
		t.Fatalf("stdout is not a JSON document: %v\n%s", err, out.String())
	}
	if doc.OK || doc.Error.Code != envelopeCodeUsage || doc.Error.Message != "--json requires --detach (the foreground path replaces the process and can print no receipt)" {
		t.Errorf("envelope = %+v, want a usage failure naming --detach", doc)
	}
	if len(*execCalls) != 0 || len(*startCalls) != 0 {
		t.Errorf("exec/start called %d/%d times on the usage refusal", len(*execCalls), len(*startCalls))
	}
}
