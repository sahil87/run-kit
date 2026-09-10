package api

import (
	"encoding/binary"
	"sync"
)

// The view-only filter sits on the GUI relay when the backend is macOS Screen
// Sharing (network "tcp"): it tracks the RFB 3.8 handshake in both directions
// and afterwards DROPS client→server KeyEvent (type 4), PointerEvent (type 5),
// and QEMU extended key event (type 255 sub-type 0) messages, so the relay can
// never inject input into the host — Screen Sharing mirrors are view-only
// through rk. On the unix backend (Linux, auth None) the filter runs in
// OBSERVE mode: the same parser runs for its side effect only (the
// last-human-input timestamp) and feedClient ALWAYS returns the chunk
// verbatim — a parser stall or confusion can never withhold or reorder a
// Linux viewer's bytes.
//
// Both parsers are streaming: handshake fields and messages may straddle
// relay chunk boundaries arbitrarily, so each direction buffers until its
// current unit completes. Server→client bytes are always forwarded; they are
// parsed only to learn handshake lengths (security-type count, ARD key
// length, ServerInit name length). Two cross-direction dependencies are
// buffered waits: the server's security-exchange framing depends on the
// client's 1-byte security choice, and the client's ARD credentials length
// depends on the server's ARD key length. On the wire the server half always
// precedes the client half it parameterizes, so a wait unblocks with the
// next feed of the other direction (or the next client chunk).

const (
	// rfbProtocolVersionLen is the 12-byte "RFB 003.008\n" banner each side
	// opens with.
	rfbProtocolVersionLen = 12
	// rfbSecurityNone / rfbSecurityARD are the security-type bytes the
	// filter can frame: None has no exchange; ARD (Apple Remote Desktop,
	// type 30) is framed by wire lengths below. Every other type is treated
	// as None-like (no exchange bytes).
	rfbSecurityNone = 1
	rfbSecurityARD  = 30
	// rfbARDHeadLen is the server's ARD security header: u16 generator +
	// u16 key length. rfbARDCredsBaseLen is the fixed encrypted-credentials
	// block the client appends to its keyLength-byte DH public key.
	rfbARDHeadLen      = 4
	rfbARDCredsBaseLen = 128
	// rfbSecResultLen is the server's 4-byte SecurityResult.
	rfbSecResultLen = 4
	// rfbServerInitHeadLen is the fixed ServerInit prefix: u16 width + u16
	// height + 16-byte pixel format + u32 name length; the name follows.
	rfbServerInitHeadLen = 24
	// guiFilterMaxCutText caps a ClientCutText payload the filter will
	// buffer awaiting completion. An absurd u32 length must not park the
	// parser forever; beyond the cap the type byte is forwarded raw and the
	// parser resyncs on the next byte (the unknown-type posture).
	guiFilterMaxCutText = 16 << 20
)

// Client message stages of the handshake tracker.
type guiFilterClientStage int

const (
	guiCStageBanner     guiFilterClientStage = iota // ProtocolVersion
	guiCStageSecChoice                              // 1-byte security choice
	guiCStageARDCreds                               // ARD: DH public key + encrypted credentials
	guiCStageClientInit                             // 1-byte shared flag
	guiCStageMessages                               // post-handshake framed messages
)

// Server message stages of the handshake tracker (all bytes forwarded; only
// lengths matter).
type guiFilterServerStage int

const (
	guiSStageBanner         guiFilterServerStage = iota // ProtocolVersion
	guiSStageSecCount                                   // 1-byte security-type count
	guiSStageSecTypes                                   // count bytes of offered types
	guiSStageSecExchange                                // waits for the client choice to be known
	guiSStageARDHead                                    // u16 generator + u16 key length
	guiSStageARDBody                                    // prime + public key (2×keyLen)
	guiSStageSecResult                                  // SecurityResult
	guiSStageServerInitHead                             // fixed ServerInit prefix
	guiSStageServerInitName                             // name bytes
	guiSStageDone                                       // handshake complete; forward verbatim
)

// guiViewFilter is the relay's per-connection RFB transformer. The relay
// feeds client bytes from its WS read loop and server bytes from its backend
// pump — separate goroutines — and the handshake parameters cross between
// the two parsers, so every feed takes mu (all work under it is bounded byte
// movement; nothing blocks).
type guiViewFilter struct {
	// drop is the view-only posture (the tcp backend): input messages are
	// withheld after the handshake. Otherwise the filter observes only.
	drop bool
	// onHumanInput fires when a post-handshake input message (KeyEvent,
	// PointerEvent, QEMU extended key) completes — on every backend, dropped
	// or not. Injected by the relay; nil-safe.
	onHumanInput func()

	mu sync.Mutex

	cStage guiFilterClientStage
	cbuf   []byte

	sStage guiFilterServerStage
	sbuf   []byte

	choiceKnown   bool
	secChoice     byte
	keyLenKnown   bool
	ardKeyLen     int
	secTypeCount  int
	serverNameLen uint32

	// Post-handshake client-message assembly: msgNeed is the expected total
	// length of the message starting at cbuf[0] (0 = length not yet
	// determined); msgDrop marks a KeyEvent/PointerEvent/QEMU-key message
	// being withheld; msgHuman marks it for the onHumanInput callback.
	msgNeed  int
	msgDrop  bool
	msgHuman bool
}

// newGuiViewFilter builds the filter for one relayed connection. The tcp
// backend (macOS Screen Sharing) is filtered view-only; on every other
// backend the parser runs in observe mode — the data path forwards every
// chunk verbatim regardless of parser state.
func newGuiViewFilter(network string, onHumanInput func()) *guiViewFilter {
	return &guiViewFilter{drop: network == "tcp", onHumanInput: onHumanInput}
}

// feedClient consumes one chunk of client→server bytes and returns the bytes
// to forward to the backend. In observe mode (non-tcp) the return is ALWAYS
// the chunk verbatim — the parse runs for its side effect only. In drop mode
// the return is possibly empty, possibly more than the chunk when a buffered
// message completes.
func (f *guiViewFilter) feedClient(chunk []byte) []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cbuf = append(f.cbuf, chunk...)
	var out []byte
	for {
		switch f.cStage {
		case guiCStageBanner:
			if !f.forwardClient(&out, rfbProtocolVersionLen) {
				return f.clientResult(chunk, out)
			}
			f.cStage = guiCStageSecChoice
		case guiCStageSecChoice:
			if len(f.cbuf) < 1 {
				return f.clientResult(chunk, out)
			}
			f.secChoice = f.cbuf[0]
			f.choiceKnown = true
			out = append(out, f.cbuf[0])
			f.cbuf = f.cbuf[1:]
			if f.secChoice == rfbSecurityARD {
				f.cStage = guiCStageARDCreds
			} else {
				f.cStage = guiCStageClientInit
			}
		case guiCStageARDCreds:
			// The credentials length follows from the server's ARD key
			// length; on the wire the server's head always precedes the
			// credentials, so an unknown length means the chunks crossed in
			// flight — hold until the server side catches up.
			if !f.keyLenKnown {
				return f.clientResult(chunk, out)
			}
			if !f.forwardClient(&out, rfbARDCredsBaseLen+f.ardKeyLen) {
				return f.clientResult(chunk, out)
			}
			f.cStage = guiCStageClientInit
		case guiCStageClientInit:
			if !f.forwardClient(&out, 1) {
				return f.clientResult(chunk, out)
			}
			f.cStage = guiCStageMessages
		case guiCStageMessages:
			if !f.pumpClientMessage(&out) {
				return f.clientResult(chunk, out)
			}
		}
	}
}

// clientResult picks feedClient's return: observe mode keeps the data path
// verbatim no matter what the parser did; drop mode returns the filtered
// output.
func (f *guiViewFilter) clientResult(chunk, out []byte) []byte {
	if !f.drop {
		return chunk
	}
	return out
}

// forwardClient emits n buffered client bytes and consumes them. False when
// the buffer holds fewer than n.
func (f *guiViewFilter) forwardClient(out *[]byte, n int) bool {
	if len(f.cbuf) < n {
		return false
	}
	*out = append(*out, f.cbuf[:n]...)
	f.cbuf = f.cbuf[n:]
	return true
}

// pumpClientMessage frames one post-handshake client→server message and
// forwards it — unless it is an input message (KeyEvent type 4, PointerEvent
// type 5, QEMU extended key event 255/0), which the view-only posture drops.
// Unknown types are forwarded raw one byte at a time (their framing is
// unknowable, and resyncing on the next byte keeps well-formed input drops
// intact). A completed input message fires onHumanInput on every backend —
// the last-human-input timestamp the agent-verb guard reads.
func (f *guiViewFilter) pumpClientMessage(out *[]byte) bool {
	if len(f.cbuf) == 0 {
		return false
	}
	if f.msgNeed == 0 {
		typ := f.cbuf[0]
		switch typ {
		case 0: // SetPixelFormat: u8 + 3 pad + 16-byte pixel format
			f.msgNeed = 20
		case 2: // SetEncodings: u8 + pad + u16 count + count×u32
			if len(f.cbuf) < 4 {
				return false
			}
			f.msgNeed = 4 + 4*int(binary.BigEndian.Uint16(f.cbuf[2:4]))
		case 3: // FramebufferUpdateRequest: u8 + incremental + x/y/w/h
			f.msgNeed = 10
		case 4: // KeyEvent: u8 + down-flag + pad + u32 keysym — human input
			f.msgNeed = 8
		case 5: // PointerEvent: u8 + button-mask + x/y — human input
			f.msgNeed = 6
		case 6: // ClientCutText: u8 + 3 pad + u32 length + payload
			if len(f.cbuf) < 8 {
				return false
			}
			n := binary.BigEndian.Uint32(f.cbuf[4:8])
			if n > guiFilterMaxCutText {
				*out = append(*out, f.cbuf[0])
				f.cbuf = f.cbuf[1:]
				return true
			}
			f.msgNeed = 8 + int(n)
		case 255: // QEMU client message: u8 + u8 sub-type; sub-type 0 is the
			// extended key event (u16 down-flag + u32 keysym + u32 keycode) —
			// human input. noVNC sends it whenever the server advertises the
			// QEMU Extended Key Event pseudo-encoding (TigerVNC does), so
			// counting plain KeyEvent alone would miss most keyboard input.
			if len(f.cbuf) < 2 {
				return false
			}
			if f.cbuf[1] != 0 {
				// Unknown sub-type: forward raw byte-wise like an unknown
				// type (the framing is unknowable).
				*out = append(*out, f.cbuf[0])
				f.cbuf = f.cbuf[1:]
				return true
			}
			f.msgNeed = 12
		default:
			*out = append(*out, f.cbuf[0])
			f.cbuf = f.cbuf[1:]
			return true
		}
		f.msgDrop = f.drop && (typ == 4 || typ == 5 || typ == 255)
		f.msgHuman = typ == 4 || typ == 5 || typ == 255
	}
	if len(f.cbuf) < f.msgNeed {
		return false
	}
	if !f.msgDrop {
		*out = append(*out, f.cbuf[:f.msgNeed]...)
	}
	f.cbuf = f.cbuf[f.msgNeed:]
	f.msgNeed = 0
	f.msgDrop = false
	if f.msgHuman && f.onHumanInput != nil {
		f.onHumanInput()
	}
	f.msgHuman = false
	return true
}

// feedServer consumes one chunk of server→client bytes and returns it
// verbatim — server output is never withheld; the parse only advances the
// handshake tracker (which the client side's ARD framing depends on, on
// every backend).
func (f *guiViewFilter) feedServer(chunk []byte) []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.sStage == guiSStageDone {
		return chunk
	}
	f.sbuf = append(f.sbuf, chunk...)
	for {
		switch f.sStage {
		case guiSStageDone:
			return chunk
		case guiSStageBanner:
			if !f.consumeServer(rfbProtocolVersionLen) {
				return chunk
			}
			f.sStage = guiSStageSecCount
		case guiSStageSecCount:
			if len(f.sbuf) < 1 {
				return chunk
			}
			f.secTypeCount = int(f.sbuf[0])
			f.sbuf = f.sbuf[1:]
			if f.secTypeCount == 0 {
				// Zero offered types is the server's failure greeting (a
				// reason string follows); the connection is doomed, so stop
				// filtering and forward whatever comes.
				f.sStage = guiSStageDone
				continue
			}
			f.sStage = guiSStageSecTypes
		case guiSStageSecTypes:
			if !f.consumeServer(f.secTypeCount) {
				return chunk
			}
			f.sStage = guiSStageSecExchange
		case guiSStageSecExchange:
			// The exchange's framing depends on the client's choice, which
			// always precedes it on the wire; if the chunks crossed, hold.
			if !f.choiceKnown {
				return chunk
			}
			if f.secChoice == rfbSecurityARD {
				f.sStage = guiSStageARDHead
			} else {
				f.sStage = guiSStageSecResult
			}
		case guiSStageARDHead:
			if len(f.sbuf) < rfbARDHeadLen {
				return chunk
			}
			f.ardKeyLen = int(binary.BigEndian.Uint16(f.sbuf[2:4]))
			f.keyLenKnown = true
			f.sbuf = f.sbuf[rfbARDHeadLen:]
			f.sStage = guiSStageARDBody
		case guiSStageARDBody:
			if !f.consumeServer(2 * f.ardKeyLen) {
				return chunk
			}
			f.sStage = guiSStageSecResult
		case guiSStageSecResult:
			if !f.consumeServer(rfbSecResultLen) {
				return chunk
			}
			f.sStage = guiSStageServerInitHead
		case guiSStageServerInitHead:
			if len(f.sbuf) < rfbServerInitHeadLen {
				return chunk
			}
			f.serverNameLen = binary.BigEndian.Uint32(f.sbuf[20:24])
			f.sbuf = f.sbuf[rfbServerInitHeadLen:]
			f.sStage = guiSStageServerInitName
		case guiSStageServerInitName:
			if !f.consumeServer(int(f.serverNameLen)) {
				return chunk
			}
			f.sStage = guiSStageDone
		}
	}
}

// consumeServer drops n parsed handshake bytes from the server buffer. False
// when fewer than n are buffered.
func (f *guiViewFilter) consumeServer(n int) bool {
	if len(f.sbuf) < n {
		return false
	}
	f.sbuf = f.sbuf[n:]
	return true
}
