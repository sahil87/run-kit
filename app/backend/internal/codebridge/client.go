// Package codebridge is the Go client for the rk-code-bridge code-server
// extension: host-record discovery, liveness verification, and the NDJSON
// request/response protocol over the per-host Unix socket. The registry under
// cb/hosts/ is a discovery hint only — liveness is re-derived from the live
// socket on every call, never cached (Constitution II).
package codebridge

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
)

// ErrorKind is the extension's error classification for a failed request.
type ErrorKind string

// The protocol's four error kinds; the CLI maps all of them to exit 1
// (operational), so no finer typing is needed on this side.
const (
	ErrKindUnknownCommand ErrorKind = "unknown-command"
	ErrKindThrew          ErrorKind = "threw"
	ErrKindTimeout        ErrorKind = "timeout"
	ErrKindBadRequest     ErrorKind = "bad-request"
)

// Request is the one message sent per connection: {"id","command","args",
// "timeoutMs"}. Args are pre-parsed JSON literals (see ParseArgs); an absent
// TimeoutMs leaves the extension's 30s default in charge.
type Request struct {
	ID        string            `json:"id"`
	Command   string            `json:"command"`
	Args      []json.RawMessage `json:"args"`
	TimeoutMs int64             `json:"timeoutMs,omitempty"`
}

// BridgeError is the error half of a response envelope.
type BridgeError struct {
	Kind    ErrorKind `json:"kind"`
	Message string    `json:"message"`
}

// Response is the one message received per connection:
// {"id","ok":true,"result","ms"} or {"id","ok":false,"error":{…}}.
type Response struct {
	ID     string          `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Ms     int64           `json:"ms"`
	Error  *BridgeError    `json:"error,omitempty"`
}

// PingInfo is the __ping result payload: {folder, pid, version}.
type PingInfo struct {
	Folder  string `json:"folder"`
	PID     int    `json:"pid"`
	Version string `json:"version"`
}

// Call sends req over the Unix socket at sock and reads the single-line
// NDJSON response. One request per connection by protocol: the connection is
// closed after the response. The caller bounds the exchange via ctx — when
// ctx carries a deadline it is applied to both dial and read, so a hung host
// cannot block the CLI past it.
func Call(ctx context.Context, sock string, req Request) (Response, error) {
	if req.Args == nil {
		// The extension's parseRequest expects an array; nil would marshal as null.
		req.Args = []json.RawMessage{}
	}
	var d net.Dialer
	conn, err := d.DialContext(ctx, "unix", sock)
	if err != nil {
		return Response{}, fmt.Errorf("codebridge: dial %s: %w", sock, err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return Response{}, fmt.Errorf("codebridge: encode request: %w", err)
	}
	if _, err := conn.Write(append(payload, '\n')); err != nil {
		return Response{}, fmt.Errorf("codebridge: send request: %w", err)
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil && len(line) == 0 {
		return Response{}, fmt.Errorf("codebridge: read response: %w", err)
	}
	var resp Response
	if err := json.Unmarshal(line, &resp); err != nil {
		return Response{}, fmt.Errorf("codebridge: decode response: %w", err)
	}
	return resp, nil
}

// Ping runs the bridge-internal __ping command against sock.
func Ping(ctx context.Context, sock string) (PingInfo, error) {
	resp, err := Call(ctx, sock, Request{ID: "__ping", Command: "__ping"})
	if err != nil {
		return PingInfo{}, err
	}
	if !resp.OK {
		if resp.Error != nil {
			return PingInfo{}, fmt.Errorf("codebridge: ping: %s: %s", resp.Error.Kind, resp.Error.Message)
		}
		return PingInfo{}, fmt.Errorf("codebridge: ping: response not ok")
	}
	var info PingInfo
	if err := json.Unmarshal(resp.Result, &info); err != nil {
		return PingInfo{}, fmt.Errorf("codebridge: ping: decode result: %w", err)
	}
	return info, nil
}
