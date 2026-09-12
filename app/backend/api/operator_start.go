package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// operatorStartProcessTimeout bounds the spawned `rk operator` process itself.
// It must exceed the launched agent's own boot + kickoff bound (the
// cron.DefaultRespawnTimeout precedent). DETACHED from the request: the
// response goes out on the JSON receipt while the process finishes its kickoff.
// operatorStartReceiptTimeout bounds the wait for the receipt line only. Vars
// (not consts) so tests can shrink the receipt bound — the cmd/rk
// operatorDeliverDeadline precedent.
var (
	operatorStartProcessTimeout = 90 * time.Second
	operatorStartReceiptTimeout = 30 * time.Second
)

// errOperatorStartTimeout marks the no-receipt-in-bound outcome so the handler
// maps it to 504 while every other exec failure is a 502.
var errOperatorStartTimeout = errors.New("operator start timed out")

// operatorStartReceipt is the parsed `rk operator --json` success document (the
// envelope's result — see cmd/rk's operatorReceipt).
type operatorStartReceipt struct {
	Window  string `json:"window"`
	Server  string `json:"server"`
	Created bool   `json:"created"`
}

// operatorStartRunFn is the exec seam behind POST /api/operator/start: run argv
// (the daemon's own binary + `operator -L <server> --json`), returning the
// parsed receipt, the captured stderr, and the failure (errOperatorStartTimeout
// on a receipt timeout). Package var seam (the resolveSelfPathFn precedent) so
// handler tests stub the exec; the default owns the process lifetime.
var operatorStartRunFn = runOperatorStartExec

// handleOperatorStart serves POST /api/operator/start?server= — start the
// server's operator window by exec'ing this daemon's own binary as
// `rk operator -L <server> --json`, responding once the receipt line parses.
// POST per Constitution IX; the body is ignored.
//
// POST /api/operator/start → 202 {"windowId","server"} | 409 {code:operator_exists,windowId} | 500/502/504 {"error"}
func (s *Server) handleOperatorStart(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)

	sess, err := s.sessions.FetchSessions(r.Context(), server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if op := findOperatorWindow(sess); op != nil {
		writeOperatorExists(w, op.WindowID)
		return
	}

	selfPath, err := resolveSelfPathFn()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not determine executable path")
		return
	}

	receipt, stderr, err := operatorStartRunFn(r.Context(), []string{selfPath, "operator", "-L", server, "--json"})
	if err != nil {
		if errors.Is(err, errOperatorStartTimeout) {
			writeError(w, http.StatusGatewayTimeout, errOperatorStartTimeout.Error())
			return
		}
		msg := firstNonEmptyLine(stderr)
		if msg == "" {
			msg = err.Error()
		}
		writeError(w, http.StatusBadGateway, msg)
		return
	}
	if !receipt.Created {
		// The singleton probe beat the pre-check — same 409 contract.
		writeOperatorExists(w, receipt.Window)
		return
	}

	s.initSSEHub()
	s.sseHub.wake(server)
	writeJSON(w, http.StatusAccepted, map[string]string{"windowId": receipt.Window, "server": receipt.Server})
}

// writeOperatorExists is the shared 409 body for both operator-present
// detections: writeErrorCode's shape plus the incumbent window id.
func writeOperatorExists(w http.ResponseWriter, windowID string) {
	writeJSON(w, http.StatusConflict, map[string]string{
		"error":    "operator already present",
		"code":     "operator_exists",
		"windowId": windowID,
	})
}

// runOperatorStartExec is the production operatorStartRunFn: an argv-slice
// exec.CommandContext (never a shell string, Constitution I) under a detached
// 90s context, reading stdout line-by-line until the rk JSON receipt parses
// (30s bound), then letting the process finish its kickoff in a goroutine.
func runOperatorStartExec(_ context.Context, argv []string) (operatorStartReceipt, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), operatorStartProcessTimeout)
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return operatorStartReceipt{}, "", err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		cancel()
		return operatorStartReceipt{}, "", err
	}

	type scanResult struct {
		receipt operatorStartReceipt
		ok      bool
	}
	scanned := make(chan scanResult, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if receipt, ok := parseOperatorStartReceipt(scanner.Bytes()); ok {
				scanned <- scanResult{receipt, true}
				// Keep draining past the receipt so a chatty process never
				// blocks on a full stdout pipe.
				_, _ = io.Copy(io.Discard, stdout)
				return
			}
		}
		scanned <- scanResult{}
	}()

	timer := time.NewTimer(operatorStartReceiptTimeout)
	defer timer.Stop()
	select {
	case res := <-scanned:
		if res.ok {
			go func() {
				defer cancel()
				if err := cmd.Wait(); err != nil {
					slog.Warn("operator start exited non-zero after its receipt", "err", err)
				}
			}()
			return res.receipt, "", nil
		}
		// stdout closed with no receipt — the process is exiting or gone.
		defer cancel()
		if err := cmd.Wait(); err != nil {
			return operatorStartReceipt{}, stderr.String(), err
		}
		return operatorStartReceipt{}, stderr.String(), errors.New("operator exited without a receipt")
	case <-timer.C:
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		cancel()
		return operatorStartReceipt{}, stderr.String(), errOperatorStartTimeout
	}
}

// parseOperatorStartReceipt recognizes one stdout line as the rk --json
// success envelope carrying the operator receipt; every other line (chatter,
// the {"ok":false} failure document) is skipped.
func parseOperatorStartReceipt(line []byte) (operatorStartReceipt, bool) {
	var env struct {
		OK     bool                  `json:"ok"`
		Result *operatorStartReceipt `json:"result"`
	}
	if err := json.Unmarshal(line, &env); err != nil || !env.OK || env.Result == nil {
		return operatorStartReceipt{}, false
	}
	return *env.Result, true
}

func firstNonEmptyLine(s string) string {
	for line := range strings.Lines(s) {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
