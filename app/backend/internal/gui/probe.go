package gui

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"syscall"
	"time"
)

// Probe budget: the dial is short (a local socket answers or refuses
// instantly); each read is bounded so a half-alive server cannot hang the
// caller. Vars, not consts, so tests shrink them.
var (
	probeDialTimeout = 500 * time.Millisecond
	probeReadTimeout = 2 * time.Second
)

// rfbBanner is the RFB 3.8 protocol-version string both sides open with.
const rfbBanner = "RFB 003.008\n"

// maxServerNameBytes bounds the ServerInit name allocation — the name is
// diagnostic only; an absurd length from a misbehaving server must not be
// trusted.
const maxServerNameBytes = 1 << 20

// Probe checks an RFB endpoint and, on the unix backend, completes the
// minimal RFB 3.8 handshake (banner, security type None, ClientInit
// shared=1, ServerInit) to learn the framebuffer geometry. The tcp backend
// (macOS Screen Sharing) stops after reading the banner — auth would need
// the Keychain password — and reports zero geometry.
//
// Dial and banner failures are classified in Info.Reason ("not running",
// "dial failed: …", "bad banner") with a nil error; protocol failures deeper
// into the handshake return a non-nil error.
func Probe(ctx context.Context, network, addr string) (Info, error) {
	d := net.Dialer{Timeout: probeDialTimeout}
	conn, err := d.DialContext(ctx, network, addr)
	if err != nil {
		if errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ENOENT) {
			return Info{Reason: "not running"}, nil
		}
		return Info{Reason: "dial failed: " + err.Error()}, nil
	}
	defer conn.Close()

	banner := make([]byte, len(rfbBanner))
	if err := readFull(conn, banner); err != nil || string(banner) != rfbBanner {
		return Info{Reason: "bad banner"}, nil
	}
	if network == "tcp" {
		return Info{Reachable: true}, nil
	}

	if _, err := conn.Write([]byte(rfbBanner)); err != nil {
		return Info{}, fmt.Errorf("probe: writing banner: %w", err)
	}

	count := make([]byte, 1)
	if err := readFull(conn, count); err != nil {
		return Info{}, fmt.Errorf("probe: reading security types: %w", err)
	}
	if count[0] == 0 {
		return Info{}, errors.New("probe: server offered no security types")
	}
	types := make([]byte, int(count[0]))
	if err := readFull(conn, types); err != nil {
		return Info{}, fmt.Errorf("probe: reading security types: %w", err)
	}
	offered := false
	for _, ty := range types {
		if ty == 1 { // None
			offered = true
			break
		}
	}
	if !offered {
		return Info{}, errors.New("probe: security type None not offered")
	}
	if _, err := conn.Write([]byte{1}); err != nil {
		return Info{}, fmt.Errorf("probe: selecting security type None: %w", err)
	}

	result := make([]byte, 4)
	if err := readFull(conn, result); err != nil {
		return Info{}, fmt.Errorf("probe: reading security result: %w", err)
	}
	if binary.BigEndian.Uint32(result) != 0 {
		return Info{}, errors.New("probe: security handshake rejected")
	}

	// ClientInit: shared-flag 1 (the session is shared).
	if _, err := conn.Write([]byte{1}); err != nil {
		return Info{}, fmt.Errorf("probe: writing client init: %w", err)
	}

	serverInit := make([]byte, 24)
	if err := readFull(conn, serverInit); err != nil {
		return Info{}, fmt.Errorf("probe: reading server init: %w", err)
	}
	width := int(binary.BigEndian.Uint16(serverInit[0:2]))
	height := int(binary.BigEndian.Uint16(serverInit[2:4]))
	nameLen := binary.BigEndian.Uint32(serverInit[20:24])
	if nameLen > maxServerNameBytes {
		return Info{}, fmt.Errorf("probe: server name length %d exceeds the bound", nameLen)
	}
	if err := readFull(conn, make([]byte, nameLen)); err != nil {
		return Info{}, fmt.Errorf("probe: reading server name: %w", err)
	}
	return Info{Reachable: true, Width: width, Height: height}, nil
}

// readFull fills buf from conn with a per-read deadline.
func readFull(conn net.Conn, buf []byte) error {
	if len(buf) == 0 {
		return nil
	}
	if err := conn.SetReadDeadline(time.Now().Add(probeReadTimeout)); err != nil {
		return err
	}
	_, err := io.ReadFull(conn, buf)
	return err
}
