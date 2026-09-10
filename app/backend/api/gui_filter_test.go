package api

import (
	"encoding/binary"
	"math/rand"
	"testing"
)

// rfbTestServerInit builds a ServerInit message (1920×1080, zeroed pixel
// format, given name).
func rfbTestServerInit(name string) []byte {
	b := make([]byte, rfbServerInitHeadLen)
	binary.BigEndian.PutUint16(b[0:2], 1920)
	binary.BigEndian.PutUint16(b[2:4], 1080)
	binary.BigEndian.PutUint32(b[20:24], uint32(len(name)))
	return append(b, name...)
}

// The four post-handshake client messages the view-only table drives:
// FramebufferUpdateRequest, KeyEvent, PointerEvent, ClientCutText.
var (
	rfbTestFUR          = []byte{3, 0, 0, 0, 0, 0, 0x07, 0x80, 0x04, 0x38}
	rfbTestKeyEvent     = []byte{4, 1, 0, 0, 0, 0, 0, 61}
	rfbTestPointerEvent = []byte{5, 1, 0, 10, 0, 20}
	rfbTestCutText      = append([]byte{6, 0, 0, 0, 0, 0, 0, 2}, 'h', 'i')
	rfbTestClientBanner = []byte("RFB 003.008\n")
	rfbTestClientInit   = []byte{1} // shared=1
	rfbTestSecResult    = []byte{0, 0, 0, 0}
)

// guiFilterStep is one wire event in a handshake script: 'c' feeds
// client→server bytes, 's' feeds server→client bytes. Order follows the RFB
// wire order so the cross-direction length dependencies resolve naturally.
type guiFilterStep struct {
	dir  byte
	data []byte
}

// noneHandshake is the RFB 3.8 security-type-1 (None) exchange.
func noneHandshake() []guiFilterStep {
	return []guiFilterStep{
		{'s', []byte("RFB 003.008\n")},
		{'c', rfbTestClientBanner},
		{'s', []byte{1, rfbSecurityNone}}, // one offered type: None
		{'c', []byte{rfbSecurityNone}},
		{'s', rfbTestSecResult},
		{'c', rfbTestClientInit},
		{'s', rfbTestServerInit("run-kit")},
	}
}

// ardHandshake is the security-type-30 (Apple Remote Desktop) exchange:
// u16 generator + u16 key length + prime + public key server→client, then
// the client's key-length-byte DH public key + 128-byte credentials block.
func ardHandshake() ([]guiFilterStep, []byte) {
	const keyLen = 8
	head := make([]byte, rfbARDHeadLen)
	binary.BigEndian.PutUint16(head[0:2], 2)      // generator
	binary.BigEndian.PutUint16(head[2:4], keyLen) // key length
	body := make([]byte, 2*keyLen)                // prime + public key
	for i := range body {
		body[i] = byte(i + 1)
	}
	creds := make([]byte, rfbARDCredsBaseLen+keyLen)
	for i := range creds {
		creds[i] = byte(i)
	}
	return []guiFilterStep{
		{'s', []byte("RFB 003.008\n")},
		{'c', rfbTestClientBanner},
		{'s', []byte{1, rfbSecurityARD}},
		{'c', []byte{rfbSecurityARD}},
		{'s', append(head, body...)},
		{'c', creds},
		{'s', rfbTestSecResult},
		{'c', rfbTestClientInit},
		{'s', rfbTestServerInit("run-kit")},
	}, creds
}

// runGuiFilterScript feeds a script through the filter, splitting each step's
// bytes per split (0 = whole step, 1 = byte-by-byte, n = chunks of n), and
// returns the concatenated client→server and server→client forwarded bytes.
func runGuiFilterScript(f *guiViewFilter, script []guiFilterStep, split int) (clientOut, serverOut []byte) {
	feed := func(data []byte, sink func([]byte) []byte) []byte {
		var out []byte
		if split <= 0 {
			return sink(data)
		}
		for len(data) > 0 {
			n := split
			if n > len(data) {
				n = len(data)
			}
			out = append(out, sink(data[:n])...)
			data = data[n:]
		}
		return out
	}
	for _, step := range script {
		if step.dir == 'c' {
			clientOut = append(clientOut, feed(step.data, f.feedClient)...)
		} else {
			serverOut = append(serverOut, feed(step.data, f.feedServer)...)
		}
	}
	return clientOut, serverOut
}

func TestGuiViewFilterNoneHandshakeDropsInput(t *testing.T) {
	script := append(noneHandshake(),
		guiFilterStep{'c', rfbTestFUR},
		guiFilterStep{'c', rfbTestKeyEvent},
		guiFilterStep{'c', rfbTestPointerEvent},
		guiFilterStep{'c', rfbTestCutText},
	)
	var wantServer []byte
	for _, step := range script {
		if step.dir == 's' {
			wantServer = append(wantServer, step.data...)
		}
	}
	wantClient := concatBytes(
		rfbTestClientBanner, []byte{rfbSecurityNone}, rfbTestClientInit,
		rfbTestFUR, rfbTestCutText, // KeyEvent and PointerEvent dropped
	)

	for _, split := range []int{0, 1, 3} {
		f := newGuiViewFilter("tcp", nil)
		clientOut, serverOut := runGuiFilterScript(f, script, split)
		if string(clientOut) != string(wantClient) {
			t.Fatalf("split=%d client→server = %v, want %v", split, clientOut, wantClient)
		}
		if string(serverOut) != string(wantServer) {
			t.Fatalf("split=%d server→client = %v, want %v (all server bytes forward verbatim)", split, serverOut, wantServer)
		}
	}
}

func TestGuiViewFilterARDHandshakeDropsInput(t *testing.T) {
	handshake, creds := ardHandshake()
	script := append(handshake,
		guiFilterStep{'c', rfbTestKeyEvent},
		guiFilterStep{'c', rfbTestPointerEvent},
		guiFilterStep{'c', rfbTestFUR},
	)
	wantClient := concatBytes(
		rfbTestClientBanner, []byte{rfbSecurityARD}, creds, rfbTestClientInit,
		rfbTestFUR, // KeyEvent and PointerEvent dropped; ARD credentials pass
	)

	for _, split := range []int{0, 1} {
		f := newGuiViewFilter("tcp", nil)
		clientOut, _ := runGuiFilterScript(f, script, split)
		if string(clientOut) != string(wantClient) {
			t.Fatalf("split=%d client→server = %v, want %v", split, clientOut, wantClient)
		}
	}
}

func TestGuiViewFilterUnixObservesVerbatim(t *testing.T) {
	stream := concatBytes(rfbTestFUR, rfbTestKeyEvent, rfbTestPointerEvent, rfbTestCutText)
	f := newGuiViewFilter("unix", nil)
	if got := f.feedClient(stream); string(got) != string(stream) {
		t.Fatalf("unix filter altered client bytes: %v, want %v", got, stream)
	}
	if got := f.feedServer(stream); string(got) != string(stream) {
		t.Fatalf("unix filter altered server bytes: %v, want %v", got, stream)
	}
}

// The QEMU extended key event (255/0): u8 type, u8 sub-type, u16 down-flag,
// u32 keysym, u32 keycode — noVNC's keyboard path against TigerVNC.
var rfbTestQEMUKeyEvent = []byte{255, 0, 0, 1, 0, 0, 0, 61, 0, 0, 0, 38}

// Observe mode (unix): every chunk forwards verbatim even when the parser is
// mid-message, and the human-input callback fires once per completed input
// message — after the handshake, never during it.
func TestGuiViewFilterUnixObserveMode(t *testing.T) {
	var inputs int
	f := newGuiViewFilter("unix", func() { inputs++ })

	// Handshake bytes must not count as input; feed them split across chunks.
	for _, step := range noneHandshake() {
		data := step.data
		for len(data) > 0 {
			n := 3
			if n > len(data) {
				n = len(data)
			}
			var out []byte
			if step.dir == 'c' {
				out = f.feedClient(data[:n])
			} else {
				out = f.feedServer(data[:n])
			}
			if string(out) != string(data[:n]) {
				t.Fatalf("observe mode altered %q bytes: %v, want %v", step.dir, out, data[:n])
			}
			data = data[n:]
		}
	}
	if inputs != 0 {
		t.Fatalf("callback fired %d times during the handshake, want 0", inputs)
	}

	// A PointerEvent split across two frames: both chunks forward verbatim
	// and the callback fires once, after the second.
	if got := f.feedClient(rfbTestPointerEvent[:4]); string(got) != string(rfbTestPointerEvent[:4]) {
		t.Fatalf("mid-message chunk = %v, want verbatim %v", got, rfbTestPointerEvent[:4])
	}
	if inputs != 0 {
		t.Fatalf("callback fired mid-message, want completion-only")
	}
	if got := f.feedClient(rfbTestPointerEvent[4:]); string(got) != string(rfbTestPointerEvent[4:]) {
		t.Fatalf("completing chunk = %v, want verbatim %v", got, rfbTestPointerEvent[4:])
	}
	if inputs != 1 {
		t.Fatalf("inputs = %d after one PointerEvent, want 1", inputs)
	}

	f.feedClient(rfbTestKeyEvent)
	f.feedClient(rfbTestQEMUKeyEvent)
	f.feedClient(rfbTestFUR) // not input
	if inputs != 3 {
		t.Fatalf("inputs = %d, want 3 (pointer + key + QEMU key; FUR is not input)", inputs)
	}
}

// The tcp view-only drop set gains the QEMU extended key event: no input
// reaches the host, whatever encoding the client picked.
func TestGuiViewFilterTCPDropsQEMUKeyEvent(t *testing.T) {
	script := append(noneHandshake(),
		guiFilterStep{'c', rfbTestQEMUKeyEvent},
		guiFilterStep{'c', rfbTestFUR},
	)
	wantClient := concatBytes(
		rfbTestClientBanner, []byte{rfbSecurityNone}, rfbTestClientInit,
		rfbTestFUR, // the QEMU key event is dropped
	)
	for _, split := range []int{0, 1, 5} {
		f := newGuiViewFilter("tcp", nil)
		clientOut, _ := runGuiFilterScript(f, script, split)
		if string(clientOut) != string(wantClient) {
			t.Fatalf("split=%d client→server = %v, want %v", split, clientOut, wantClient)
		}
	}
}

// An unknown QEMU sub-type has unknowable framing: forwarded raw byte-wise,
// resyncing on the next byte.
func TestGuiViewFilterQEMUUnknownSubtypeForwardedRaw(t *testing.T) {
	script := append(noneHandshake(),
		guiFilterStep{'c', []byte{255, 7}}, // unknown sub-type 7
		guiFilterStep{'c', rfbTestFUR},
	)
	wantClient := concatBytes(
		rfbTestClientBanner, []byte{rfbSecurityNone}, rfbTestClientInit,
		[]byte{255, 7}, rfbTestFUR,
	)
	f := newGuiViewFilter("tcp", nil)
	clientOut, _ := runGuiFilterScript(f, script, 1)
	if string(clientOut) != string(wantClient) {
		t.Fatalf("client→server = %v, want %v", clientOut, wantClient)
	}
}

func TestGuiViewFilterRandomSplits(t *testing.T) {
	handshake, creds := ardHandshake()
	script := append(handshake,
		guiFilterStep{'c', rfbTestFUR},
		guiFilterStep{'c', rfbTestKeyEvent},
		guiFilterStep{'c', rfbTestPointerEvent},
		guiFilterStep{'c', rfbTestCutText},
	)
	wantClient := concatBytes(
		rfbTestClientBanner, []byte{rfbSecurityARD}, creds, rfbTestClientInit,
		rfbTestFUR, rfbTestCutText,
	)

	rng := rand.New(rand.NewSource(42))
	for trial := 0; trial < 25; trial++ {
		f := newGuiViewFilter("tcp", nil)
		var clientOut []byte
		for _, step := range script {
			data := step.data
			for len(data) > 0 {
				n := 1 + rng.Intn(len(data))
				var out []byte
				if step.dir == 'c' {
					out = f.feedClient(data[:n])
				} else {
					out = f.feedServer(data[:n])
				}
				if step.dir == 'c' {
					clientOut = append(clientOut, out...)
				}
				data = data[n:]
			}
		}
		if string(clientOut) != string(wantClient) {
			t.Fatalf("trial %d: client→server = %v, want %v", trial, clientOut, wantClient)
		}
	}
}

func TestGuiViewFilterUnknownTypeForwardedRaw(t *testing.T) {
	script := append(noneHandshake(),
		guiFilterStep{'c', []byte{99, 99, 99}}, // unknown type: forwarded byte-wise
		guiFilterStep{'c', rfbTestKeyEvent},    // still dropped after resync
		guiFilterStep{'c', rfbTestFUR},
	)
	wantClient := concatBytes(
		rfbTestClientBanner, []byte{rfbSecurityNone}, rfbTestClientInit,
		[]byte{99, 99, 99}, rfbTestFUR,
	)
	f := newGuiViewFilter("tcp", nil)
	clientOut, _ := runGuiFilterScript(f, script, 1)
	if string(clientOut) != string(wantClient) {
		t.Fatalf("client→server = %v, want %v", clientOut, wantClient)
	}
}

func concatBytes(parts ...[]byte) []byte {
	var out []byte
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}
