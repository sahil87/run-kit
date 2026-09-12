package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/testutil"
	"rk/internal/tmux"
)

// stubOperatorStartRun swaps the exec + self-path seams for the duration of a
// handler test, returning a pointer to the recorded argv (nil until called).
func stubOperatorStartRun(t *testing.T, run func(ctx context.Context, argv []string) (operatorStartReceipt, string, error)) *[]string {
	t.Helper()
	var gotArgv []string
	prevRun, prevSelf := operatorStartRunFn, resolveSelfPathFn
	operatorStartRunFn = func(ctx context.Context, argv []string) (operatorStartReceipt, string, error) {
		gotArgv = append([]string(nil), argv...)
		return run(ctx, argv)
	}
	resolveSelfPathFn = func() (string, error) { return "/fake/rk", nil }
	t.Cleanup(func() {
		operatorStartRunFn, resolveSelfPathFn = prevRun, prevSelf
	})
	return &gotArgv
}

func operatorStartRequest(server string) (*httptest.ResponseRecorder, *http.Request) {
	return httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/operator/start?server="+server, strings.NewReader(`{}`))
}

func decodeOperatorStartBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v (body %q)", err, rec.Body.String())
	}
	return body
}

func TestOperatorStart_CreatedReturns202WakesHub(t *testing.T) {
	server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
	gotArgv := stubOperatorStartRun(t, func(ctx context.Context, argv []string) (operatorStartReceipt, string, error) {
		return operatorStartReceipt{Window: "@7", Server: "default", Created: true}, "", nil
	})

	rec, req := operatorStartRequest("default")
	server.buildRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if body := decodeOperatorStartBody(t, rec); body["windowId"] != "@7" || body["server"] != "default" {
		t.Errorf("body = %v, want {windowId:@7, server:default}", body)
	}
	if want := []string{"/fake/rk", "operator", "-L", "default", "--json"}; strings.Join(*gotArgv, " ") != strings.Join(want, " ") {
		t.Errorf("argv = %v, want %v", *gotArgv, want)
	}
	// Exactly one wake-driven pass: the pre-check already consumed one fetch
	// (synchronous inside ServeHTTP), so the wake adds exactly one more.
	afterPreCheck := tracker.count.Load()
	expectWake(t, tracker, afterPreCheck, "operator start")
	time.Sleep(300 * time.Millisecond)
	if got := tracker.count.Load(); got != afterPreCheck+1 {
		t.Errorf("FetchSessions count = %d, want %d (pre-check + exactly one wake-driven pass)", got, afterPreCheck+1)
	}
}

func TestOperatorStart_OperatorExistsPreCheck(t *testing.T) {
	fetcher := &mockSessionFetcher{result: []sessions.ProjectSession{{
		Name:    "s1",
		Windows: []tmux.WindowInfo{{WindowID: "@3", Name: "operator", Role: "operator"}},
	}}}
	router := NewTestRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), fetcher, &mockTmuxOps{}, "test-host")
	stubOperatorStartRun(t, func(ctx context.Context, argv []string) (operatorStartReceipt, string, error) {
		t.Error("exec seam called despite an operator already present")
		return operatorStartReceipt{}, "", nil
	})

	rec, req := operatorStartRequest("default")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	body := decodeOperatorStartBody(t, rec)
	if body["code"] != "operator_exists" || body["windowId"] != "@3" {
		t.Errorf("body = %v, want code=operator_exists with the incumbent windowId @3", body)
	}
}

func TestOperatorStart_FetchErrorIs500(t *testing.T) {
	fetcher := &mockSessionFetcher{err: errors.New("tmux down")}
	router := NewTestRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), fetcher, &mockTmuxOps{}, "test-host")
	stubOperatorStartRun(t, func(ctx context.Context, argv []string) (operatorStartReceipt, string, error) {
		t.Error("exec seam called despite the fetch failure")
		return operatorStartReceipt{}, "", nil
	})

	rec, req := operatorStartRequest("default")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestOperatorStart_CreatedFalseIs409(t *testing.T) {
	fetcher := &mockSessionFetcher{result: []sessions.ProjectSession{{Name: "s1"}}}
	router := NewTestRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), fetcher, &mockTmuxOps{}, "test-host")
	stubOperatorStartRun(t, func(ctx context.Context, argv []string) (operatorStartReceipt, string, error) {
		// The singleton probe found one the pre-check missed.
		return operatorStartReceipt{Window: "@5", Server: "default", Created: false}, "", nil
	})

	rec, req := operatorStartRequest("default")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	body := decodeOperatorStartBody(t, rec)
	if body["code"] != "operator_exists" || body["windowId"] != "@5" {
		t.Errorf("body = %v, want code=operator_exists with windowId @5", body)
	}
}

func TestOperatorStart_ExecFailureCarriesStderrLine(t *testing.T) {
	fetcher := &mockSessionFetcher{result: []sessions.ProjectSession{{Name: "s1"}}}
	router := NewTestRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), fetcher, &mockTmuxOps{}, "test-host")
	stubOperatorStartRun(t, func(ctx context.Context, argv []string) (operatorStartReceipt, string, error) {
		return operatorStartReceipt{}, "\nrun-kit operator: fab not found on PATH — install fab\nsecond line\n", errors.New("exit status 1")
	})

	rec, req := operatorStartRequest("default")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502; body=%s", rec.Code, rec.Body.String())
	}
	if body := decodeOperatorStartBody(t, rec); body["error"] != "run-kit operator: fab not found on PATH — install fab" {
		t.Errorf("error = %q, want the first non-empty stderr line", body["error"])
	}
}

func TestOperatorStart_ReceiptTimeoutIs504(t *testing.T) {
	fetcher := &mockSessionFetcher{result: []sessions.ProjectSession{{Name: "s1"}}}
	router := NewTestRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), fetcher, &mockTmuxOps{}, "test-host")
	stubOperatorStartRun(t, func(ctx context.Context, argv []string) (operatorStartReceipt, string, error) {
		return operatorStartReceipt{}, "", errOperatorStartTimeout
	})

	rec, req := operatorStartRequest("default")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504; body=%s", rec.Code, rec.Body.String())
	}
	if body := decodeOperatorStartBody(t, rec); body["error"] != "operator start timed out" {
		t.Errorf("error = %q, want %q", body["error"], "operator start timed out")
	}
}

// TestRunOperatorStartExec exercises the default seam against stub scripts
// standing in for the rk binary.
func TestRunOperatorStartExec(t *testing.T) {
	t.Run("chatter lines are skipped until the receipt parses", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "rk", "#!/bin/sh\necho 'some chatter'\necho '{\"ok\":true,\"result\":{\"window\":\"@7\",\"server\":\"default\",\"created\":true}}'\n")
		receipt, stderr, err := runOperatorStartExec(context.Background(), []string{filepath.Join(dir, "rk"), "operator", "-L", "default", "--json"})
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if stderr != "" {
			t.Errorf("stderr = %q, want empty", stderr)
		}
		if receipt.Window != "@7" || receipt.Server != "default" || !receipt.Created {
			t.Errorf("receipt = %+v, want {@7 default created:true}", receipt)
		}
	})

	t.Run("returns on the receipt while the process keeps running", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "rk", "#!/bin/sh\necho '{\"ok\":true,\"result\":{\"window\":\"@9\",\"server\":\"default\",\"created\":true}}'\nsleep 2\n")
		start := time.Now()
		receipt, _, err := runOperatorStartExec(context.Background(), []string{filepath.Join(dir, "rk")})
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if receipt.Window != "@9" {
			t.Errorf("receipt = %+v, want window @9", receipt)
		}
		if elapsed := time.Since(start); elapsed > time.Second {
			t.Errorf("returned after %v, want the receipt-fast path well under the process's 2s kickoff", elapsed)
		}
	})

	t.Run("a non-zero exit without a receipt surfaces stderr", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "rk", "#!/bin/sh\necho 'run-kit operator: fab not found on PATH' >&2\nexit 1\n")
		_, stderr, err := runOperatorStartExec(context.Background(), []string{filepath.Join(dir, "rk")})
		if err == nil {
			t.Fatal("err = nil, want the non-zero exit")
		}
		if errors.Is(err, errOperatorStartTimeout) {
			t.Errorf("err = %v, must not be the timeout sentinel", err)
		}
		if !strings.Contains(stderr, "fab not found on PATH") {
			t.Errorf("stderr = %q, want the script's error line", stderr)
		}
	})

	t.Run("no receipt within the bound kills the process", func(t *testing.T) {
		prev := operatorStartReceiptTimeout
		operatorStartReceiptTimeout = 150 * time.Millisecond
		t.Cleanup(func() { operatorStartReceiptTimeout = prev })
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "rk", "#!/bin/sh\nexec sleep 5\n")
		start := time.Now()
		_, _, err := runOperatorStartExec(context.Background(), []string{filepath.Join(dir, "rk")})
		if !errors.Is(err, errOperatorStartTimeout) {
			t.Fatalf("err = %v, want errOperatorStartTimeout", err)
		}
		if elapsed := time.Since(start); elapsed > 2*time.Second {
			t.Errorf("returned after %v, want the kill to land promptly after the 150ms bound", elapsed)
		}
	})

	t.Run("a failure envelope line does not count as a receipt", func(t *testing.T) {
		dir := t.TempDir()
		testutil.WriteStub(t, dir, "rk", "#!/bin/sh\necho '{\"ok\":false,\"error\":{\"code\":\"operational\",\"message\":\"boom\"}}'\necho 'run-kit operator: boom' >&2\nexit 1\n")
		_, stderr, err := runOperatorStartExec(context.Background(), []string{filepath.Join(dir, "rk")})
		if err == nil || errors.Is(err, errOperatorStartTimeout) {
			t.Fatalf("err = %v, want the non-zero exit (not a receipt, not a timeout)", err)
		}
		if !strings.Contains(stderr, "boom") {
			t.Errorf("stderr = %q, want the script's error line", stderr)
		}
	})
}
