package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"testing"

	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

// withPortOwnerStub swaps findPortOwner to the given stub for the test's
// duration. Tests use this to drive --force paths without spawning lsof/ss.
func withPortOwnerStub(t *testing.T, stub func(ctx context.Context, host string, port int) (*PortOwner, error)) {
	t.Helper()
	orig := findPortOwner
	findPortOwner = stub
	t.Cleanup(func() { findPortOwner = orig })
}

// withInnerServePID swaps innerServePIDFn to a stub returning the given pid/err.
func withInnerServePID(t *testing.T, pid int, err error) {
	t.Helper()
	orig := innerServePIDFn
	innerServePIDFn = func() (int, error) { return pid, err }
	t.Cleanup(func() { innerServePIDFn = orig })
}

// pinFreePort sets RK_HOST/RK_PORT to a known-free port for the duration of
// the test. Mirrors the pattern used in daemon_test.go.
func pinFreePort(t *testing.T) (string, int) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatalf("listener Close: %v", err)
	}
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", fmt.Sprintf("%d", port))
	return "127.0.0.1", port
}

// findChildCmd returns the immediate child cobra command of parent with the
// given name, or nil when no match is found.
func findChildCmd(parent *cobra.Command, name string) *cobra.Command {
	for _, c := range parent.Commands() {
		if c.Name() == name {
			return c
		}
	}
	return nil
}

func TestDaemonCmdRegistered(t *testing.T) {
	dCmd := findChildCmd(rootCmd, "daemon")
	if dCmd == nil {
		t.Fatal("rootCmd has no 'daemon' subcommand")
	}
	for _, want := range []string{"start", "stop", "restart", "status"} {
		if findChildCmd(dCmd, want) == nil {
			t.Errorf("daemon subcommand %q not registered", want)
		}
	}
}

func TestDaemonStatus_RejectsForceFlag(t *testing.T) {
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetErr(buf)
	rootCmd.SetArgs([]string{"daemon", "status", "--force"})
	t.Cleanup(func() { rootCmd.SetArgs(nil) })

	err := rootCmd.Execute()
	if err == nil {
		t.Fatal("rk daemon status --force returned nil; expected unknown-flag error")
	}
	if !strings.Contains(err.Error(), "unknown flag") {
		t.Errorf("error = %q, want it to contain 'unknown flag'", err)
	}
}

func TestDaemonStatusJSON_ShapeIsValid(t *testing.T) {
	if daemon.IsRunning() {
		t.Skip("skipping — production daemon is running")
	}
	pinFreePort(t)
	withPortOwnerStub(t, func(ctx context.Context, host string, port int) (*PortOwner, error) {
		return nil, nil
	})

	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetErr(buf)
	rootCmd.SetArgs([]string{"daemon", "status", "--json"})
	t.Cleanup(func() { rootCmd.SetArgs(nil) })

	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("rk daemon status --json failed: %v", err)
	}

	var got statusReport
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("status output is not valid JSON: %v\noutput: %q", err, buf.String())
	}
	if got.Daemon.Running {
		t.Errorf("expected daemon.running=false (no production daemon), got true")
	}
	if got.Port.State != portStateFree {
		t.Errorf("expected port.state=%q, got %q", portStateFree, got.Port.State)
	}
	if got.Port.Port == 0 {
		t.Error("expected port.port to be populated")
	}
}

func TestDaemonStart_ForceRefusesSelfKill(t *testing.T) {
	if daemon.IsRunning() {
		t.Skip("skipping — production daemon is running")
	}

	// Bind to a port we control so daemon.Start()'s port-probe refuses with
	// the substring isPortInUseErr looks for. Keep the listener open across
	// the test so the probe stays true.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", fmt.Sprintf("%d", port))

	// Stub findPortOwner to return PID matching the (stubbed) inner serve PID.
	const fakePID = 42424
	withPortOwnerStub(t, func(ctx context.Context, host string, port int) (*PortOwner, error) {
		return &PortOwner{PID: fakePID, Command: "rk", Source: "test"}, nil
	})
	withInnerServePID(t, fakePID, nil)

	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetErr(buf)
	rootCmd.SetArgs([]string{"daemon", "start", "--force"})
	t.Cleanup(func() { rootCmd.SetArgs(nil) })

	err = rootCmd.Execute()
	if err == nil {
		t.Fatal("expected --force-kill-self refusal, got nil")
	}
	if !strings.Contains(err.Error(), "refusing to --force-kill self") {
		t.Errorf("error = %q; want it to contain 'refusing to --force-kill self'", err)
	}
}

func TestFindPortOwnerImpl_FindsListener(t *testing.T) {
	if _, err := exec.LookPath("lsof"); err != nil {
		t.Skip("lsof not on PATH")
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	owner, err := findPortOwnerImpl(context.Background(), "127.0.0.1", port)
	if err != nil {
		t.Fatalf("findPortOwnerImpl error: %v", err)
	}
	if owner == nil {
		t.Fatal("findPortOwnerImpl returned nil owner for a bound listener")
	}
	if owner.PID != os.Getpid() {
		t.Errorf("owner.PID = %d, want %d (test process)", owner.PID, os.Getpid())
	}
	if owner.Source != "lsof" {
		t.Errorf("owner.Source = %q, want %q", owner.Source, "lsof")
	}
}
