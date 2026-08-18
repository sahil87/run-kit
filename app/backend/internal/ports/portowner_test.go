package ports

import (
	"context"
	"net"
	"os"
	"os/exec"
	"testing"
)

func TestFindPortOwner_FindsListener(t *testing.T) {
	if _, err := exec.LookPath("lsof"); err != nil {
		t.Skip("lsof not on PATH")
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	owner, err := FindPortOwner(context.Background(), "127.0.0.1", port)
	if err != nil {
		t.Fatalf("FindPortOwner error: %v", err)
	}
	if owner == nil {
		t.Fatal("FindPortOwner returned nil owner for a bound listener")
	}
	if owner.PID != os.Getpid() {
		t.Errorf("owner.PID = %d, want %d (test process)", owner.PID, os.Getpid())
	}
	if owner.Source != "lsof" {
		t.Errorf("owner.Source = %q, want %q", owner.Source, "lsof")
	}
}
