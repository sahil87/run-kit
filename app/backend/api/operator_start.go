package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
// envelope's result — see cmd/rk's operatorReceipt). Dir/DirRung are additive
// cmd/rk fields: omitted by older binaries, tolerated by this parse.
type operatorStartReceipt struct {
	Window  string `json:"window"`
	Server  string `json:"server"`
	Created bool   `json:"created"`
	Dir     string `json:"dir,omitempty"`
	DirRung string `json:"dir_rung,omitempty"`
}

// operatorStartExitFn fires once the receipted `rk operator` process exits —
// the receipt already returned to the HTTP caller, so this carries the
// post-receipt facts: the receipt, the full captured stderr (the kickoff:
// undelivered note lives there), and the process's exit error.
type operatorStartExitFn func(receipt operatorStartReceipt, stderr string, exitErr error)

// operatorStartRunFn is the exec seam behind POST /api/operator/start: run argv
// (the daemon's own binary + `operator -L <server> --json`), returning the
// parsed receipt, the captured stderr, and the failure (errOperatorStartTimeout
// on a receipt timeout). onExit fires from the post-receipt Wait goroutine.
// Package var seam (the resolveSelfPathFn precedent) so handler tests stub the
// exec; the default owns the process lifetime.
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

	receipt, stderr, err := operatorStartRunFn(r.Context(), []string{selfPath, "operator", "-L", server, "--json"}, s.operatorKickoffExit(server))
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
// 90s context, accumulating stdout until the rk JSON receipt — one indented
// multi-line document (outputSink.writeEnvelope uses json.MarshalIndent) —
// parses as a whole (30s bound), then letting the process finish its kickoff
// in a goroutine that fires onExit after the exit lands.
func runOperatorStartExec(_ context.Context, argv []string, onExit operatorStartExitFn) (operatorStartReceipt, string, error) {
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
		var pending bytes.Buffer
		for scanner.Scan() {
			line := scanner.Bytes()
			if pending.Len() == 0 && !bytes.HasPrefix(bytes.TrimSpace(line), []byte("{")) {
				continue // chatter on the data channel — a document starts with {
			}
			pending.Write(line)
			pending.WriteByte('\n')
			receipt, complete, ok := parseOperatorStartEnvelope(pending.Bytes())
			if !complete {
				continue // still mid-document
			}
			pending.Reset()
			if !ok {
				continue // a complete non-success document (the {"ok":false} failure)
			}
			scanned <- scanResult{receipt, true}
			// Keep draining past the receipt so a chatty process never
			// blocks on a full stdout pipe.
			_, _ = io.Copy(io.Discard, stdout)
			return
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
				err := cmd.Wait()
				if err != nil {
					slog.Warn("operator start exited non-zero after its receipt", "err", err)
				}
				if onExit != nil {
					onExit(res.receipt, stderr.String(), err)
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

// parseOperatorStartEnvelope decodes one accumulated stdout chunk as a whole
// rk --json envelope document. complete=false means the bytes are a JSON
// prefix (keep accumulating); complete=true with ok=false means a full
// document that is not the success receipt (chatter-shaped bytes or the
// failure envelope) — the caller drops the chunk and keeps scanning.
func parseOperatorStartEnvelope(data []byte) (receipt operatorStartReceipt, complete, ok bool) {
	var env struct {
		OK     bool                  `json:"ok"`
		Result *operatorStartReceipt `json:"result"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		var syn *json.SyntaxError
		if errors.As(err, &syn) && syn.Error() == "unexpected end of JSON input" {
			return operatorStartReceipt{}, false, false
		}
		return operatorStartReceipt{}, true, false
	}
	if !env.OK || env.Result == nil {
		return operatorStartReceipt{}, true, false
	}
	return *env.Result, true, true
}

// kickoffNotePrefix heads the single stderr line rk prints when its kickoff
// delivery fails (exit code stays 0): `kickoff: undelivered reason=<r>
// prompt=<p> dir=<d>`. The internal/cron kickoffUndeliveredMarker precedent.
const kickoffNotePrefix = "kickoff: undelivered reason="

// parseKickoffNote extracts the reason and dir from the stderr kickoff note.
// prompt is free text between the two labeled fields, so dir is cut from the
// LAST " dir=" on the line (any " dir=" inside the prompt sits earlier), then
// ends at the next space so extra trailing fields are tolerated. ok=false when
// no well-formed note is present (including a missing prompt= or empty dir).
func parseKickoffNote(stderr string) (reason, dir string, ok bool) {
	for line := range strings.Lines(stderr) {
		rest, found := strings.CutPrefix(strings.TrimSpace(line), kickoffNotePrefix)
		if !found {
			continue
		}
		reason, rest, _ := strings.Cut(rest, " ")
		if reason == "" {
			continue
		}
		rest, found = strings.CutPrefix(rest, "prompt=")
		if !found {
			continue
		}
		idx := strings.LastIndex(rest, " dir=")
		if idx < 0 {
			continue
		}
		dir, _, _ = strings.Cut(rest[idx+len(" dir="):], " ")
		if dir == "" {
			continue
		}
		return reason, dir, true
	}
	return "", "", false
}

// operatorKickoffExit builds the onExit callback for one operator start: when
// the process's stderr carries the kickoff note, warn and notify so a
// connected client can paste /fab-operator into the operator terminal by hand.
// A clean exit with no note logs nothing and broadcasts nothing.
func (s *Server) operatorKickoffExit(server string) operatorStartExitFn {
	return func(receipt operatorStartReceipt, stderr string, _ error) {
		reason, dir, ok := parseKickoffNote(stderr)
		if !ok {
			return
		}
		slog.Warn("operator kickoff undelivered",
			"server", server, "window", receipt.Window, "reason", reason, "dir", dir)
		s.initSSEHub()
		s.sseHub.broadcastNotifyTagged(
			"Operator kickoff not delivered",
			fmt.Sprintf("Operator on %s started in %s but /fab-operator was not delivered (%s) — paste it into the operator terminal", server, dir, reason),
			// The frontend has no dedicated /$server/operator path — the operator
			// surface IS the operator window's own terminal route, the same
			// deep-link shape the waiting-window push uses.
			waitingPushURL(server, receipt.Window),
			"operator-kickoff",
		)
	}
}

func firstNonEmptyLine(s string) string {
	for line := range strings.Lines(s) {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
