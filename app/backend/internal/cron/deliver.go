package cron

import (
	"context"

	"rk/internal/inject"
	"rk/internal/tmux"
)

// deliver.go — the injection-engine Deliverer. Delivery goes through the
// shared inject.Engine (never raw send-keys), inheriting the pane-mode guard,
// sanitized buffer paste, novelty echo probe, and submit verification.

// cronSendBuffer is this client's named paste buffer — per-client buffer names
// keep concurrent deliveries on separate engines from interleaving (the
// agent-send precedent is rk-agent-send).
const cronSendBuffer = "rk-cron-send"

// cronInjectTmux is the engine's inject.Tmux substrate: the name-parameterized
// buffer primitives of internal/tmux, addressed by the fire's stamped server.
// It mirrors the riff delivery adapter; cmd packages cannot be imported from
// here.
type cronInjectTmux struct{}

func (cronInjectTmux) ClearPaneMode(ctx context.Context, paneID, server string) error {
	return tmux.ClearPaneModeCtx(ctx, paneID, server)
}
func (cronInjectTmux) CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error) {
	return tmux.CapturePaneCtx(ctx, paneID, lines, server)
}
func (cronInjectTmux) SetBuffer(ctx context.Context, name, text, server string) error {
	return tmux.SetBufferCtx(ctx, name, text, server)
}
func (cronInjectTmux) PasteBuffer(ctx context.Context, name, paneID, server string) error {
	return tmux.PasteBufferCtx(ctx, name, paneID, server)
}
func (cronInjectTmux) PasteBufferRaw(ctx context.Context, name, paneID, server string) error {
	return tmux.PasteBufferRawCtx(ctx, name, paneID, server)
}
func (cronInjectTmux) SendEnter(ctx context.Context, paneID, server string) error {
	return tmux.SendEnterToPaneCtx(ctx, paneID, server)
}
func (cronInjectTmux) SendKeys(ctx context.Context, paneID, server string, keys ...string) error {
	return tmux.SendKeysToPane(ctx, paneID, server, keys...)
}
func (cronInjectTmux) PaneSize(ctx context.Context, paneID, server string) (int, int, error) {
	return tmux.PaneSizeCtx(ctx, paneID, server)
}

// EngineDeliverer is the production Deliverer: it types the fire's payload
// into the resolved pane through the injection engine. The readState and send
// seams exist so tests run without a live tmux.
type EngineDeliverer struct {
	engine *inject.Engine
	// readState reads the target pane's agent state at delivery time (fresher
	// than the eval-time facts) for the when-idle gate.
	readState func(ctx context.Context, paneID, server string) (string, error)
	send      func(ctx context.Context, t inject.Tmux, server, paneID, text string, submit bool) error
}

// NewEngineDeliverer returns the deliverer on its own engine (buffer
// rk-cron-send) over the real tmux primitives.
func NewEngineDeliverer() *EngineDeliverer {
	engine := inject.NewEngine(cronSendBuffer)
	return &EngineDeliverer{
		engine:    engine,
		readState: tmux.PaneAgentState,
		send:      engine.Send,
	}
}

// Deliver sends one due fire. `deliver: when-idle` gates on the pane's
// agent-state read at delivery time: active or waiting (the operator
// request-lane busy predicate) holds the fire — outcome held-busy with Held
// set, which the tick never logs, so the hold is realized as cross-tick retry.
// Idle and unknown ("") states deliver: an unknown-state pane carries no
// gateable signal. A send error is outcome "failed: <detail>" — the logged
// failure advances the anchor, so the retry lands next due period, not next
// tick.
func (d *EngineDeliverer) Deliver(ctx context.Context, fire Fire) Outcome {
	if fire.Entry.Deliver == DeliverWhenIdle {
		state, err := d.readState(ctx, fire.PaneID, fire.Server)
		if err != nil {
			return Outcome{Status: "failed", Detail: "agent-state read: " + err.Error()}
		}
		if state == tmux.AgentStateActive || state == tmux.AgentStateWaiting {
			return Outcome{Status: "held-busy", Detail: state, Held: true}
		}
	}
	if err := d.send(ctx, cronInjectTmux{}, fire.Server, fire.PaneID, inject.Sanitize(fire.Entry.Payload), true); err != nil {
		return Outcome{Status: "failed", Detail: err.Error()}
	}
	return Outcome{Status: "delivered"}
}
