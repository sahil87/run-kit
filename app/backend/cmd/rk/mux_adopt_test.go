package main

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// muxAdoptFake holds the installed adopt-verb seams and their call recordings.
// aliveErr nil = a live server answers on the socket (adopt proceeds); non-nil
// = dead/absent socket, an operational refusal.
type muxAdoptFake struct {
	aliveErr     error
	isManaged    bool
	isManagedErr error
	markErr      error
	reloadErr    error
	markCalls    []string // server names passed to MarkServerManaged
	unmarkCalls  []string
	reloadCalls  []string
}

// installMuxAdoptFakes wires the mux-adopt seams to the fake and restores the
// production defaults on cleanup (the installMuxNewFakes pattern).
func installMuxAdoptFakes(t *testing.T, f *muxAdoptFake) {
	t.Helper()
	origAlive, origIsManaged := muxAdoptServerAliveFn, muxAdoptIsManagedFn
	origMark, origUnmark, origReload := muxAdoptMarkManagedFn, muxAdoptUnmarkManagedFn, muxAdoptReloadConfigFn
	t.Cleanup(func() {
		muxAdoptServerAliveFn, muxAdoptIsManagedFn = origAlive, origIsManaged
		muxAdoptMarkManagedFn, muxAdoptUnmarkManagedFn, muxAdoptReloadConfigFn = origMark, origUnmark, origReload
	})

	muxAdoptServerAliveFn = func(_ context.Context, _ string) error { return f.aliveErr }
	muxAdoptIsManagedFn = func(_ context.Context, _ string) (bool, error) {
		return f.isManaged, f.isManagedErr
	}
	muxAdoptMarkManagedFn = func(_ context.Context, server string) error {
		f.markCalls = append(f.markCalls, server)
		return f.markErr
	}
	muxAdoptUnmarkManagedFn = func(_ context.Context, server string) error {
		f.unmarkCalls = append(f.unmarkCalls, server)
		return nil
	}
	muxAdoptReloadConfigFn = func(server string) error {
		f.reloadCalls = append(f.reloadCalls, server)
		return f.reloadErr
	}
}

// TestMuxAdoptSuccess: probe → managed-check → mark → reload → report; stdout
// carries exactly the one report line.
func TestMuxAdoptSuccess(t *testing.T) {
	f := &muxAdoptFake{}
	installMuxAdoptFakes(t, f)

	stdout, _, err := runMuxCmd(t, "adopt", "ext1")
	if err != nil {
		t.Fatalf("err = %v, want success", err)
	}
	if stdout != "adopted ext1\n" {
		t.Errorf("stdout = %q, want the single report line", stdout)
	}
	if len(f.markCalls) != 1 || f.markCalls[0] != "ext1" {
		t.Errorf("mark calls = %v, want one mark of ext1", f.markCalls)
	}
	if len(f.reloadCalls) != 1 || f.reloadCalls[0] != "ext1" {
		t.Errorf("reload calls = %v, want one reload of ext1", f.reloadCalls)
	}
	if len(f.unmarkCalls) != 0 {
		t.Errorf("unmark ran on a successful adopt: %v", f.unmarkCalls)
	}
}

// TestMuxAdoptAlreadyManaged: an already-managed target prints the
// already-managed report, exits 0, and performs no tmux mutation.
func TestMuxAdoptAlreadyManaged(t *testing.T) {
	f := &muxAdoptFake{isManaged: true}
	installMuxAdoptFakes(t, f)

	stdout, _, err := runMuxCmd(t, "adopt", "ext1")
	if err != nil {
		t.Fatalf("err = %v, want success", err)
	}
	if stdout != "already managed ext1\n" {
		t.Errorf("stdout = %q, want the already-managed report line", stdout)
	}
	if len(f.markCalls) != 0 || len(f.reloadCalls) != 0 || len(f.unmarkCalls) != 0 {
		t.Errorf("mutation ran on an already-managed server: marks=%v reloads=%v unmarks=%v",
			f.markCalls, f.reloadCalls, f.unmarkCalls)
	}
}

// TestMuxAdoptReloadFailureUnmarks: a failed reload best-effort unmarks the
// just-stamped server and exits 1 — no stamped-but-unconfigured survivor, no
// report line.
func TestMuxAdoptReloadFailureUnmarks(t *testing.T) {
	f := &muxAdoptFake{reloadErr: errors.New("source-file: boom")}
	installMuxAdoptFakes(t, f)

	stdout, _, err := runMuxCmd(t, "adopt", "ext1")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit-1 reload failure", err)
	}
	if !strings.Contains(err.Error(), "reload config on ext1") {
		t.Errorf("err = %v, want the reload failure named", err)
	}
	if len(f.markCalls) != 1 || f.markCalls[0] != "ext1" {
		t.Errorf("mark calls = %v, want one mark of ext1", f.markCalls)
	}
	if len(f.unmarkCalls) != 1 || f.unmarkCalls[0] != "ext1" {
		t.Errorf("unmark calls = %v, want one rollback unmark of ext1", f.unmarkCalls)
	}
	if stdout != "" {
		t.Errorf("stdout = %q on reload failure, want empty", stdout)
	}
}

// TestMuxAdoptDeadSocket: no live server on the socket is operational
// (exit 1), names the server, and performs no tmux mutation.
func TestMuxAdoptDeadSocket(t *testing.T) {
	f := &muxAdoptFake{aliveErr: errors.New("no server running on /tmp/tmux-1000/gone")}
	installMuxAdoptFakes(t, f)

	stdout, _, err := runMuxCmd(t, "adopt", "gone")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit-1 dead-socket refusal", err)
	}
	if !strings.Contains(err.Error(), "gone") || !strings.Contains(err.Error(), "not running") {
		t.Errorf("err = %v, want it naming gone as not running", err)
	}
	if len(f.markCalls) != 0 || len(f.reloadCalls) != 0 || len(f.unmarkCalls) != 0 {
		t.Errorf("mutation ran on a dead socket: marks=%v reloads=%v unmarks=%v",
			f.markCalls, f.reloadCalls, f.unmarkCalls)
	}
	if stdout != "" {
		t.Errorf("stdout = %q on a dead socket, want empty", stdout)
	}
}

// TestMuxAdoptUsage: name validation, stray/missing args, and the inherited -L
// rejection are usage errors (exit 2); nothing reaches the seams.
func TestMuxAdoptUsage(t *testing.T) {
	f := &muxAdoptFake{}
	installMuxAdoptFakes(t, f)

	_, _, err := runMuxCmd(t, "adopt", "bad name!")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("invalid name: err = %v, want exit 2", err)
	}
	if !strings.Contains(err.Error(), "alphanumeric") {
		t.Errorf("err = %v, want the allowed character set named", err)
	}

	_, _, err = runMuxCmd(t, "adopt")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("missing arg: err = %v, want exit 2", err)
	}

	_, _, err = runMuxCmd(t, "adopt", "one", "two")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("stray arg: err = %v, want exit 2", err)
	}

	// The operator-tier member rejects an explicitly-set inherited -L.
	_, _, err = runMuxCmd(t, "-L", "foo", "adopt", "bar")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("inherited -L: err = %v, want exit 2", err)
	}
	if !strings.Contains(err.Error(), "--server") {
		t.Errorf("err = %v, want the rejection naming --server", err)
	}

	if len(f.markCalls) != 0 || len(f.reloadCalls) != 0 || len(f.unmarkCalls) != 0 {
		t.Errorf("mutation ran on usage errors: marks=%v reloads=%v unmarks=%v",
			f.markCalls, f.reloadCalls, f.unmarkCalls)
	}
}
