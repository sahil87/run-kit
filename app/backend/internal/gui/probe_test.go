package gui

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeRFB is an in-process fake RFB server counting accepted connections and
// recording whether the client closed after ServerInit.
type fakeRFB struct {
	ln       net.Listener
	accepts  atomic.Int32
	sawClose atomic.Bool
}

func startFakeRFB(t *testing.T, network, addr string) *fakeRFB {
	t.Helper()
	ln, err := net.Listen(network, addr)
	if err != nil {
		t.Fatalf("net.Listen(%s, %s): %v", network, addr, err)
	}
	f := &fakeRFB{ln: ln}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			f.accepts.Add(1)
			go f.serve(conn)
		}
	}()
	t.Cleanup(func() { ln.Close() })
	return f
}

// serve runs the server half of the minimal handshake: banner, security list
// [1], SecurityResult 0, ServerInit 1920x1080 named "run-kit", then waits for
// the client to hang up.
func (f *fakeRFB) serve(conn net.Conn) {
	defer conn.Close()
	buf := make([]byte, 64)
	steps := []func() error{
		func() error { _, err := conn.Write([]byte(rfbBanner)); return err },
		func() error { _, err := io.ReadFull(conn, buf[:len(rfbBanner)]); return err }, // client banner
		func() error { _, err := conn.Write([]byte{1, 1}); return err },                // one security type: None
		func() error { _, err := io.ReadFull(conn, buf[:1]); return err },              // client selection
		func() error { _, err := conn.Write([]byte{0, 0, 0, 0}); return err },          // SecurityResult OK
		func() error { _, err := io.ReadFull(conn, buf[:1]); return err },              // ClientInit
		func() error {
			si := make([]byte, 24)
			binary.BigEndian.PutUint16(si[0:2], 1920)
			binary.BigEndian.PutUint16(si[2:4], 1080)
			binary.BigEndian.PutUint32(si[20:24], uint32(len("run-kit")))
			if _, err := conn.Write(si); err != nil {
				return err
			}
			_, err := conn.Write([]byte("run-kit"))
			return err
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return
		}
	}
	// The probe must close after ServerInit: the next read observes EOF.
	if _, err := conn.Read(buf[:1]); err == io.EOF {
		f.sawClose.Store(true)
	}
}

func TestProbeUnixServerInit(t *testing.T) {
	addr := filepath.Join(t.TempDir(), "host.sock")
	f := startFakeRFB(t, "unix", addr)

	info, err := Probe(context.Background(), "unix", addr)
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if !info.Reachable || info.Width != 1920 || info.Height != 1080 {
		t.Errorf("Probe = %+v, want reachable 1920x1080", info)
	}
	if got := f.accepts.Load(); got != 1 {
		t.Errorf("fake server accepted %d connections, want exactly 1", got)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !f.sawClose.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !f.sawClose.Load() {
		t.Error("client connection not closed after ServerInit")
	}
}

func TestProbeTCPStopsAtBanner(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	sawClientBanner := make(chan struct{}, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write([]byte(rfbBanner))
		// The probe must NOT answer the banner on tcp: the next read sees EOF.
		buf := make([]byte, len(rfbBanner))
		if _, err := io.ReadFull(conn, buf); err == nil {
			sawClientBanner <- struct{}{}
		}
	}()

	info, err := Probe(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("Probe: %v", err)
	}
	if !info.Reachable || info.Width != 0 || info.Height != 0 {
		t.Errorf("Probe = %+v, want reachable with zero geometry", info)
	}
	select {
	case <-sawClientBanner:
		t.Error("tcp probe sent the client banner — it must stop after reading the server banner")
	case <-time.After(500 * time.Millisecond):
	}
}

func TestProbeNotListening(t *testing.T) {
	start := time.Now()
	info, err := Probe(context.Background(), "unix", filepath.Join(t.TempDir(), "absent.sock"))
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("Probe: %v, want a classified Info, not an error", err)
	}
	if info.Reachable {
		t.Error("Probe on a dead socket: Reachable = true, want false")
	}
	if info.Reason != "not running" {
		t.Errorf("Probe Reason = %q, want %q", info.Reason, "not running")
	}
	if elapsed > 2*probeDialTimeout {
		t.Errorf("Probe took %v on a dead socket, want within the %v dial budget", elapsed, probeDialTimeout)
	}
}

func TestProbeBadBanner(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write([]byte("HELLO WORLD!")) // 12 bytes, not RFB
		io.Copy(io.Discard, conn)
	}()

	info, err := Probe(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("Probe: %v, want a classified Info, not an error", err)
	}
	if info.Reachable || info.Reason != "bad banner" {
		t.Errorf("Probe = %+v, want unreachable with reason %q", info, "bad banner")
	}
}

func TestProbeBannerReadFailureIsClassified(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		conn.Close() // EOF before any banner byte
	}()

	info, err := Probe(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("Probe: %v, want a classified Info, not an error", err)
	}
	if info.Reachable {
		t.Error("Probe on a server that closes before the banner: Reachable = true, want false")
	}
	if !strings.HasPrefix(info.Reason, "banner read failed: ") {
		t.Errorf("Probe Reason = %q, want a %q prefix carrying the read error", info.Reason, "banner read failed: ")
	}
	if info.Reason == "bad banner" {
		t.Error("a read error must not be reported as a banner mismatch")
	}
}
