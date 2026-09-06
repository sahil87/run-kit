package cron

import (
	"context"
	"errors"
	"testing"

	"rk/internal/inject"
	"rk/internal/tmux"
)

// sendCall records one engine send invocation.
type sendCall struct {
	server, paneID, text string
	submit               bool
}

// newTestDeliverer builds an EngineDeliverer over scripted state reads and a
// recording send seam.
func newTestDeliverer(states map[string]string, stateErr error) (*EngineDeliverer, *[]sendCall) {
	calls := &[]sendCall{}
	d := NewEngineDeliverer()
	d.readState = func(ctx context.Context, paneID, server string) (string, error) {
		return states[paneID], stateErr
	}
	d.send = func(ctx context.Context, t inject.Tmux, server, paneID, text string, submit bool) error {
		*calls = append(*calls, sendCall{server, paneID, text, submit})
		return nil
	}
	return d, calls
}

func deliverFire(deliver, payload string) Fire {
	return Fire{
		Server: "live1",
		PaneID: "%42",
		Entry: Entry{
			ID:      "a3f9",
			Payload: payload,
			Deliver: deliver,
		},
	}
}

func TestEngineDelivererImmediate(t *testing.T) {
	for _, deliver := range []string{DeliverImmediate, ""} {
		t.Run("deliver="+deliver, func(t *testing.T) {
			d, calls := newTestDeliverer(nil, nil)
			outcome := d.Deliver(context.Background(), deliverFire(deliver, "sweep now"))
			if outcome != (Outcome{Status: "delivered"}) {
				t.Errorf("outcome = %+v, want delivered", outcome)
			}
			if len(*calls) != 1 {
				t.Fatalf("sends = %d, want 1", len(*calls))
			}
			c := (*calls)[0]
			if c.server != "live1" || c.paneID != "%42" || c.text != "sweep now" || !c.submit {
				t.Errorf("send = %+v, want the payload pasted+submitted to %%42 on live1", c)
			}
			if d.engine.Buffer() != cronSendBuffer {
				t.Errorf("engine buffer = %q, want %q", d.engine.Buffer(), cronSendBuffer)
			}
		})
	}
}

func TestEngineDelivererSanitizesPayload(t *testing.T) {
	d, calls := newTestDeliverer(nil, nil)
	d.Deliver(context.Background(), deliverFire(DeliverImmediate, "hi\x1b[201~ there\r\n"))
	if got := (*calls)[0].text; got != "hi[201~ there\n" {
		t.Errorf("sent text = %q, want control bytes stripped and CRLF normalized", got)
	}
}

// TestEngineDelivererWhenIdleBusyPredicate pins the busy predicate: active and
// waiting hold (Held, held-busy, nothing sent); idle and unknown deliver.
func TestEngineDelivererWhenIdleBusyPredicate(t *testing.T) {
	cases := []struct {
		state     string
		wantHeld  bool
		wantState string
	}{
		{tmux.AgentStateActive, true, "held-busy"},
		{tmux.AgentStateWaiting, true, "held-busy"},
		{tmux.AgentStateIdle, false, "delivered"},
		{"", false, "delivered"},
	}
	for _, tc := range cases {
		t.Run("state="+tc.state, func(t *testing.T) {
			d, calls := newTestDeliverer(map[string]string{"%42": tc.state}, nil)
			outcome := d.Deliver(context.Background(), deliverFire(DeliverWhenIdle, "sweep"))
			if outcome.Held != tc.wantHeld || outcome.Status != tc.wantState {
				t.Errorf("outcome = %+v, want held=%v status=%q", outcome, tc.wantHeld, tc.wantState)
			}
			if tc.wantHeld && len(*calls) != 0 {
				t.Errorf("held outcome sent %d times, want 0", len(*calls))
			}
			if !tc.wantHeld && len(*calls) != 1 {
				t.Errorf("delivered outcome sent %d times, want 1", len(*calls))
			}
		})
	}
}

func TestEngineDelivererStateReadFailure(t *testing.T) {
	d, calls := newTestDeliverer(nil, errors.New("pane gone"))
	outcome := d.Deliver(context.Background(), deliverFire(DeliverWhenIdle, "sweep"))
	if outcome.Held || outcome.Status != "failed" {
		t.Errorf("outcome = %+v, want failed (a state read failure must not deliver blind)", outcome)
	}
	if len(*calls) != 0 {
		t.Errorf("sends = %d, want 0", len(*calls))
	}
}

func TestEngineDelivererSendFailure(t *testing.T) {
	d := NewEngineDeliverer()
	d.send = func(ctx context.Context, tm inject.Tmux, server, paneID, text string, submit bool) error {
		return errors.New("probe failed")
	}
	outcome := d.Deliver(context.Background(), deliverFire(DeliverImmediate, "sweep"))
	if outcome.Held || outcome.Status != "failed" || outcome.Detail != "probe failed" {
		t.Errorf("outcome = %+v, want `failed: probe failed`", outcome)
	}
}
