package cron

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"rk/internal/inject"
	"rk/internal/tmux"
)

// sendCall records one engine send invocation.
type sendCall struct {
	server, paneID, text string
	submit               bool
}

// newTestDeliverer builds an EngineDeliverer over scripted state reads and a
// recording send seam. The hold-bound clock pins now at backoffBase, and
// deliverFire anchors DueAt there too — override d.now to age a hold.
func newTestDeliverer(states map[string]string, stateErr error) (*EngineDeliverer, *[]sendCall) {
	calls := &[]sendCall{}
	d := NewEngineDeliverer()
	d.now = func() time.Time { return backoffBase }
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
		DueAt:  backoffBase,
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

// TestEngineDelivererHoldBound: a when-idle fire held busy past
// DefaultHoldWindow expires — outcome held-expired with Held UNSET (the tick
// logs it, the anchor advances, the fire is dropped) and nothing is sent.
// Within the window the hold is held-busy as before, and a catch-up late fire
// (DueAt = now) can never expire.
func TestEngineDelivererHoldBound(t *testing.T) {
	busy := map[string]string{"%42": tmux.AgentStateActive}

	t.Run("past the window the hold expires", func(t *testing.T) {
		d, calls := newTestDeliverer(busy, nil)
		d.now = func() time.Time { return backoffBase.Add(DefaultHoldWindow + time.Minute) }
		outcome := d.Deliver(context.Background(), deliverFire(DeliverWhenIdle, "sweep"))
		if outcome.Held || outcome.Status != "held-expired" {
			t.Errorf("outcome = %+v, want held-expired with Held unset", outcome)
		}
		if outcome.Detail != tmux.AgentStateActive {
			t.Errorf("detail = %q, want the busy state", outcome.Detail)
		}
		if len(*calls) != 0 {
			t.Errorf("sends = %d, want 0 (the bound never force-delivers)", len(*calls))
		}
	})

	t.Run("at the window edge the hold stands", func(t *testing.T) {
		d, _ := newTestDeliverer(busy, nil)
		d.now = func() time.Time { return backoffBase.Add(DefaultHoldWindow) }
		outcome := d.Deliver(context.Background(), deliverFire(DeliverWhenIdle, "sweep"))
		if !outcome.Held || outcome.Status != "held-busy" {
			t.Errorf("outcome = %+v, want held-busy (the bound is now−DueAt > window)", outcome)
		}
	})

	t.Run("catch-up late fires never expire", func(t *testing.T) {
		d, _ := newTestDeliverer(busy, nil)
		late := backoffBase.Add(24 * time.Hour)
		d.now = func() time.Time { return late }
		fire := deliverFire(DeliverWhenIdle, "sweep")
		fire.DueAt = late // catch-up construction: DueAt = now
		outcome := d.Deliver(context.Background(), fire)
		if !outcome.Held || outcome.Status != "held-busy" {
			t.Errorf("outcome = %+v, want held-busy (DueAt = now never exceeds the window)", outcome)
		}
	})

	t.Run("immediate entries ignore the window", func(t *testing.T) {
		d, calls := newTestDeliverer(busy, nil)
		d.now = func() time.Time { return backoffBase.Add(DefaultHoldWindow + time.Minute) }
		outcome := d.Deliver(context.Background(), deliverFire(DeliverImmediate, "sweep"))
		if outcome.Held || outcome.Status != "delivered" {
			t.Errorf("outcome = %+v, want delivered (the bound only gates when-idle)", outcome)
		}
		if len(*calls) != 1 {
			t.Errorf("sends = %d, want 1", len(*calls))
		}
	})
}

// TestEngineDelivererSkipIfBusy: active and waiting drop the fire —
// outcome skipped-busy with Held UNSET (logged, anchor-advancing) and nothing
// sent; idle and unknown deliver. No hold bound applies: past
// DefaultHoldWindow the outcome is still skipped-busy, and a state-read error
// is failed with the agent-state read prefix, byte-identical to when-idle.
func TestEngineDelivererSkipIfBusy(t *testing.T) {
	cases := []struct {
		state      string
		wantStatus string
		wantSends  int
	}{
		{tmux.AgentStateActive, "skipped-busy", 0},
		{tmux.AgentStateWaiting, "skipped-busy", 0},
		{tmux.AgentStateIdle, "delivered", 1},
		{"", "delivered", 1},
	}
	for _, tc := range cases {
		t.Run("state="+tc.state, func(t *testing.T) {
			d, calls := newTestDeliverer(map[string]string{"%42": tc.state}, nil)
			outcome := d.Deliver(context.Background(), deliverFire(DeliverSkipIfBusy, "sweep"))
			if outcome.Held || outcome.Status != tc.wantStatus {
				t.Errorf("outcome = %+v, want status %q with Held unset", outcome, tc.wantStatus)
			}
			if tc.wantStatus == "skipped-busy" && outcome.Detail != tc.state {
				t.Errorf("detail = %q, want the busy state %q", outcome.Detail, tc.state)
			}
			if len(*calls) != tc.wantSends {
				t.Errorf("sends = %d, want %d", len(*calls), tc.wantSends)
			}
		})
	}

	t.Run("no hold bound applies", func(t *testing.T) {
		d, calls := newTestDeliverer(map[string]string{"%42": tmux.AgentStateActive}, nil)
		d.now = func() time.Time { return backoffBase.Add(DefaultHoldWindow + time.Minute) }
		outcome := d.Deliver(context.Background(), deliverFire(DeliverSkipIfBusy, "sweep"))
		if outcome.Held || outcome.Status != "skipped-busy" {
			t.Errorf("outcome = %+v, want skipped-busy (skip-if-busy never consults DefaultHoldWindow)", outcome)
		}
		if len(*calls) != 0 {
			t.Errorf("sends = %d, want 0", len(*calls))
		}
	})

	t.Run("state read failure", func(t *testing.T) {
		d, calls := newTestDeliverer(nil, errors.New("pane gone"))
		outcome := d.Deliver(context.Background(), deliverFire(DeliverSkipIfBusy, "sweep"))
		if outcome.Held || outcome.Status != "failed" ||
			!strings.HasPrefix(outcome.Detail, "agent-state read:") {
			t.Errorf("outcome = %+v, want failed with the agent-state read prefix", outcome)
		}
		if len(*calls) != 0 {
			t.Errorf("sends = %d, want 0", len(*calls))
		}
	})
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
