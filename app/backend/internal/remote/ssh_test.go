package remote

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// stubRunCmd swaps the subprocess seam for the test's duration, recording
// every invocation and answering from the given script function.
func stubRunCmd(t *testing.T, fn func(name string, args []string) execResult) *[][]string {
	t.Helper()
	var calls [][]string
	orig := runCmdFn
	runCmdFn = func(_ context.Context, name string, args ...string) execResult {
		calls = append(calls, append([]string{name}, args...))
		return fn(name, args)
	}
	t.Cleanup(func() { runCmdFn = orig })
	return &calls
}

func TestSSHExec_ArgvShape(t *testing.T) {
	calls := stubRunCmd(t, func(string, []string) execResult { return execResult{} })

	sshExec(context.Background(), "sahil@buildbox", remoteVersionCmd, time.Second)

	if len(*calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(*calls))
	}
	got := (*calls)[0]
	want := []string{"ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "sahil@buildbox", remoteVersionCmd}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Errorf("argv = %q, want %q", got, want)
	}
}

func TestRemoteCommandsAreFixedLiteralsWithPathPrefix(t *testing.T) {
	for _, cmd := range []string{remoteVersionCmd, remoteURLCmd, remoteDaemonStartCmd, remoteDaemonJSONCmd} {
		if !strings.HasPrefix(cmd, remotePathPrefix+" rk ") {
			t.Errorf("remote command %q missing the PATH-prefixed rk shape", cmd)
		}
	}
	if remoteInstallCmd != "curl -fsSL https://shll.ai/install | sh -s -- run-kit" {
		t.Errorf("install command drifted from the docs/site/install.md standard: %q", remoteInstallCmd)
	}
}

func TestClassifiers(t *testing.T) {
	if !sshUnreachable(execResult{exitCode: 255, err: errors.New("x")}) {
		t.Error("exit 255 should classify as unreachable")
	}
	if sshUnreachable(execResult{exitCode: 1, err: errors.New("x")}) {
		t.Error("exit 1 is a remote command failure, not unreachable")
	}
	if !rkMissing(execResult{exitCode: 127, err: errors.New("x")}) {
		t.Error("exit 127 should classify as rk missing")
	}
	if !rkMissing(execResult{exitCode: 1, stderr: "sh: rk: command not found", err: errors.New("x")}) {
		t.Error("'command not found' stderr should classify as rk missing")
	}
	if rkMissing(execResult{exitCode: 1, stderr: "config file not found", err: errors.New("x")}) {
		t.Error("a bare 'not found' in unrelated stderr must NOT classify as rk missing")
	}
	if rkMissing(execResult{exitCode: 0}) {
		t.Error("success should not classify as rk missing")
	}
	if !remoteDaemonAlreadyUp(execResult{stderr: "Error: daemon already running"}) {
		t.Error("daemon-already-running should classify as up")
	}
	if !remoteDaemonAlreadyUp(execResult{stderr: "something is already serving on 127.0.0.1:3000, but not under the rk-daemon tmux session"}) {
		t.Error("already-serving-on should classify as up")
	}
}

func TestAuthFailureError_TailAndHint(t *testing.T) {
	res := execResult{
		exitCode: 255,
		stderr:   "line1\nline2\nline3\nline4\nline5\nline6\nPermission denied (publickey).\n",
		err:      errors.New("exit status 255"),
	}
	err := authFailureError("sahil@buildbox", res)
	msg := err.Error()
	if !strings.Contains(msg, "Permission denied (publickey).") {
		t.Errorf("error should carry the stderr tail: %q", msg)
	}
	if strings.Contains(msg, "line1") || strings.Contains(msg, "line2") {
		t.Errorf("error should cap the tail at %d lines: %q", stderrTailLines, msg)
	}
	if !strings.Contains(msg, "ssh sahil@buildbox") {
		t.Errorf("error should hint at a one-time interactive ssh: %q", msg)
	}
}

func TestParseRemoteVersion(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"run-kit version v3.12.7", "3.12.7"},
		{"run-kit version 3.12.7", "3.12.7"},
		{"v0.5.1-rc1", "0.5.1-rc1"},
		{"dev", ""},
		{"", ""},
	}
	for _, tt := range tests {
		if got := parseRemoteVersion(tt.in); got != tt.want {
			t.Errorf("parseRemoteVersion(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestSkewDirections(t *testing.T) {
	if !VersionOlder("3.1.0", "3.2.0") {
		t.Error("remote 3.1.0 vs local 3.2.0 should be older")
	}
	if VersionOlder("3.2.0", "3.2.0") {
		t.Error("equal versions carry no skew")
	}
	if VersionOlder("3.3.0", "3.2.0") {
		t.Error("a newer remote is never 'older' (never downgrade)")
	}
	if !VersionNewer("3.3.0", "3.2.0") {
		t.Error("remote 3.3.0 vs local 3.2.0 should be newer")
	}
	// A local dev build (no ldflags version) cannot anchor a skew decision.
	if VersionOlder("3.1.0", "dev") {
		t.Error("local 'dev' must skip the skew auto-update")
	}
	if VersionNewer("3.1.0", "dev") {
		t.Error("local 'dev' must not report newer either")
	}
	// v-prefixed forms compare like bare ones.
	if !VersionOlder("v3.1.0", "v3.2.0") {
		t.Error("v-prefixed versions should compare")
	}
}

func TestParseRemotePort(t *testing.T) {
	if p, err := parseRemotePort("http://127.0.0.1:3000\n"); err != nil || p != 3000 {
		t.Errorf("parseRemotePort = (%d, %v), want (3000, nil)", p, err)
	}
	if p, err := parseRemotePort("http://0.0.0.0:8080"); err != nil || p != 8080 {
		t.Errorf("parseRemotePort wildcard = (%d, %v), want (8080, nil)", p, err)
	}
	if _, err := parseRemotePort("no origin here"); err == nil {
		t.Error("parseRemotePort should error on garbage")
	}
	if _, err := parseRemotePort(""); err == nil {
		t.Error("parseRemotePort should error on empty output")
	}
}
