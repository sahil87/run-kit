package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"rk/internal/push"
)

type notifyCall struct {
	title, body, url string
}

// swapNotifyPush replaces the push seam for the test's duration and returns a
// call log. err, when non-nil, is what the fake push returns (fail-soft path).
func swapNotifyPush(t *testing.T, err error) *[]notifyCall {
	t.Helper()
	var calls []notifyCall
	orig := notifyPush
	notifyPush = func(ctx context.Context, title, body, url string) (push.NotifyResult, error) {
		calls = append(calls, notifyCall{title: title, body: body, url: url})
		return push.NotifyResult{}, err
	}
	t.Cleanup(func() { notifyPush = orig })
	return &calls
}

func newSayServer(t *testing.T) *Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	return &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: &mockTmuxOps{}, hostname: "test"}
}

func postSay(t *testing.T, router http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	return postJSON(t, router, "/api/say", body)
}

func TestSay_disabledDegradesToPlainNotify(t *testing.T) {
	isolateSettings(t)
	calls := swapNotifyPush(t, nil)
	server := newSayServer(t)
	server.initSSEHub()
	// A connected dashboard must not change the disabled branch: no broadcast.
	client := server.sseHub.addTestClient(make(chan hubEvent, 16), "default")
	defer server.sseHub.removeClient(client)
	drainSSE(client)

	rec := postSay(t, server.buildRouter(), `{"text":"deploy done"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(*calls) != 1 {
		t.Fatalf("push calls = %d, want 1", len(*calls))
	}
	if (*calls)[0].title != "RunKit" || (*calls)[0].body != "deploy done" || (*calls)[0].url != "" {
		t.Errorf("push = %+v, want plain notify (RunKit / deploy done / no url)", (*calls)[0])
	}
	assertNoSayEvent(t, client)
}

func TestSay_enabledNoDashboardsPushesDeepLink(t *testing.T) {
	enableVoice(t)
	calls := swapNotifyPush(t, nil)
	server := newSayServer(t)

	rec := postSay(t, server.buildRouter(), `{"text":"tests green","server":"srv","window":"3"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(*calls) != 1 {
		t.Fatalf("push calls = %d, want 1", len(*calls))
	}
	if (*calls)[0].url != "/srv/3" {
		t.Errorf("push url = %q, want %q (the /{server}/{N} deep link)", (*calls)[0].url, "/srv/3")
	}
}

func TestSay_enabledNoDashboardsNoOriginPushesPlain(t *testing.T) {
	enableVoice(t)
	calls := swapNotifyPush(t, nil)
	server := newSayServer(t)

	rec := postSay(t, server.buildRouter(), `{"text":"done"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(*calls) != 1 || (*calls)[0].url != "" {
		t.Errorf("push calls = %+v, want one plain notify (no deep link without server+window)", *calls)
	}
}

func TestSay_enabledWithDashboardBroadcasts(t *testing.T) {
	enableVoice(t)
	calls := swapNotifyPush(t, nil)
	server := newSayServer(t)
	server.initSSEHub()
	client := server.sseHub.addTestClient(make(chan hubEvent, 16), "default")
	defer server.sseHub.removeClient(client)
	drainSSE(client)

	rec := postSay(t, server.buildRouter(), `{"text":"deploy done","server":"srv","window":"@2"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(*calls) != 0 {
		t.Errorf("push calls = %d, want 0 (a connected dashboard takes the broadcast)", len(*calls))
	}

	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case ev := <-client.ch:
			s := ev.String()
			if !strings.Contains(s, "event: say") {
				continue
			}
			for _, frag := range []string{`"text":"deploy done"`, `"server":"srv"`, `"window":"@2"`, `"ts":"`} {
				if !strings.Contains(s, frag) {
					t.Errorf("say payload missing %s: %q", frag, s)
				}
			}
			return
		case <-deadline:
			t.Fatal("no say event broadcast to the connected dashboard")
		}
	}
}

func TestSay_pushFailureStaysFailSoft(t *testing.T) {
	isolateSettings(t)
	swapNotifyPush(t, errors.New("push endpoint down"))
	server := newSayServer(t)

	rec := postSay(t, server.buildRouter(), `{"text":"done"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (push failures are fail-soft); body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestSay_badRequests(t *testing.T) {
	enableVoice(t)
	calls := swapNotifyPush(t, nil)
	server := newSayServer(t)
	router := server.buildRouter()

	for _, tc := range []struct {
		name string
		body string
	}{
		{"malformed json", `{not json`},
		{"missing text", `{}`},
		{"empty text", `{"text":""}`},
		{"whitespace text", `{"text":"  \n "}`},
		{"all-control text", `{"text":"\u0001\u001b"}`},
		{"invalid server", `{"text":"hi","server":"bad;name"}`},
		{"invalid window", `{"text":"hi","window":"main"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := postSay(t, router, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
	if len(*calls) != 0 {
		t.Errorf("push calls = %d across 400s, want 0", len(*calls))
	}
}

func TestSay_sanitizesControlBytes(t *testing.T) {
	isolateSettings(t)
	calls := swapNotifyPush(t, nil)
	server := newSayServer(t)

	rec := postSay(t, server.buildRouter(), "{\"text\":\"ok\\u0001done\"}")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if (*calls)[0].body != "okdone" {
		t.Errorf("push body = %q, want %q (control bytes stripped)", (*calls)[0].body, "okdone")
	}
}

func assertNoSayEvent(t *testing.T, client *sseClient) {
	t.Helper()
	select {
	case ev := <-client.ch:
		if strings.Contains(ev.String(), "event: say") {
			t.Errorf("unexpected say broadcast: %q", ev.String())
		}
	case <-time.After(150 * time.Millisecond):
	}
}
