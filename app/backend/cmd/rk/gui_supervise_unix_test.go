//go:build unix

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// guiGroupGone polls until the process group pgid is fully reaped
// (kill(-pgid, 0) → ESRCH) or the deadline expires.
func guiGroupGone(pgid int, within time.Duration) bool {
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(-pgid, 0); err == syscall.ESRCH {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

func TestGuiSuperviseStartWMOwnGroupSetsPgid(t *testing.T) {
	cmd, err := guiSuperviseStartWM(context.Background(), []string{"/bin/sh", "-c", "sleep 30"}, ":0", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		t.Fatalf("Getpgid(%d): %v", pid, err)
	}
	if pgid != pid {
		t.Errorf("pgid = %d, want pid %d — Setpgid makes the child's pid its pgid", pgid, pid)
	}
	guiStopWM(cmd, true)
	if !guiGroupGone(pid, 2*time.Second) {
		t.Errorf("process group %d still alive after guiStopWM", pid)
	}
}

func TestGuiStopWMSignalsWholeGroup(t *testing.T) {
	cmd, err := guiSuperviseStartWM(context.Background(), []string{"/bin/sh", "-c", "sleep 30 & wait"}, ":0", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	start := time.Now()
	guiStopWM(cmd, true)
	if elapsed := time.Since(start); elapsed >= 2*time.Second {
		t.Errorf("guiStopWM took %s, want well under guiWMStopTimeout on the SIGTERM path", elapsed)
	}
	// The grandchild (sleep 30) shares the group — the group signal must reap it.
	if !guiGroupGone(pid, 2*time.Second) {
		t.Errorf("process group %d still alive after guiStopWM — the grandchild was orphaned", pid)
	}
}

func TestGuiStopWMEscalatesToSIGKILL(t *testing.T) {
	buf := captureGuiSuperviseLog(t)
	orig := guiWMStopTimeout
	t.Cleanup(func() { guiWMStopTimeout = orig })
	guiWMStopTimeout = 200 * time.Millisecond

	// The ready file gates the stop on the trap being installed — signalling
	// before `trap "" TERM` runs would kill the shell on the default
	// disposition and never exercise the escalation.
	ready := filepath.Join(t.TempDir(), "trap-ready")
	cmd, err := guiSuperviseStartWM(context.Background(), []string{"/bin/sh", "-c", `trap "" TERM; touch "$0"; while :; do sleep 1; done`, ready}, ":0", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := os.Stat(ready); err != nil {
		t.Fatalf("trap never installed: %v", err)
	}

	pid := cmd.Process.Pid
	start := time.Now()
	guiStopWM(cmd, true)
	if elapsed := time.Since(start); elapsed >= 2*time.Second {
		t.Errorf("guiStopWM took %s with a TERM-ignoring child, want SIGKILL escalation after 200ms", elapsed)
	}
	if want := "did not exit within 200ms; killing its process group"; !strings.Contains(buf.String(), want) {
		t.Errorf("log =\n%s\nwant the escalation line containing %q", buf.String(), want)
	}
	if !guiGroupGone(pid, 2*time.Second) {
		t.Errorf("process group %d still alive after the SIGKILL escalation", pid)
	}
}
