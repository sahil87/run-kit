package cron

import (
	"time"
)

// Diagnostic is a structured skip/suppression note — never an error. Ticks and
// loads surface these (and log them at debug level); nothing about a
// diagnostic aborts evaluation.
type Diagnostic struct {
	Server  string
	EntryID string
	Reason  string
	Detail  string
}

// FireReason is why a fire is due: the schedule predicate or the wake edge.
type FireReason string

const (
	FireSchedule FireReason = "schedule"
	FireWake     FireReason = "wake"
)

// TargetFacts is one entry's resolved fire-time target (T010's gatherer is the
// producer). Unresolved is "" when the target resolved; otherwise it carries
// the resolution failure detail and the entry's fires are unresolvable this
// tick.
type TargetFacts struct {
	PaneID string
	// AgentState and StateEpoch are the target pane's reconciled
	// @rk_pane_agent_state read — StateEpoch is the backoff anchor input (the
	// raw idle epoch joined against the delivery log).
	AgentState string
	StateEpoch int64
	Unresolved string
}

// Resolved reports whether the target resolved to a live pane.
func (f TargetFacts) Resolved() bool { return f.Unresolved == "" }

// Fire is one due delivery: the entry, the resolved reason, and the resolved
// target pane.
type Fire struct {
	Server string
	Entry  Entry
	Reason FireReason
	PaneID string
	// Rung is the backoff ladder rung being fired (0 for other schedules).
	Rung int
	At   time.Time
}

// EvalInput is everything the stateless evaluator needs, all disk-derivable:
// the server's entries, per-entry resolved target facts, the server agent-state
// fingerprint, the parsed delivery log, the previous wake cursor, the fab
// operator state distillation, and now.
type EvalInput struct {
	Server      string
	Now         time.Time
	Entries     []Entry
	Facts       map[string]TargetFacts
	Fingerprint string
	Log         []LogLine
	Cursor      WakeCursor
	Operator    OperatorState
	// FreshThreshold is the operator-loop-fresh guard's freshness window;
	// zero selects DefaultOperatorLoopFreshThreshold.
	FreshThreshold time.Duration
}

// EvalResult carries the due fires, the skip/suppression diagnostics, and the
// next wake cursor (to be persisted by the tick orchestrator).
type EvalResult struct {
	Fires      []Fire
	Diags      []Diagnostic
	NextCursor WakeCursor
}

// Evaluate is the pure core (R4): no package-level mutable state, no I/O —
// equal inputs return deep-equal results. Composition order per entry (R9):
// muted → schedule/wake due math → target resolution → guards — guards are
// ALWAYS evaluated before a fire is emitted, so suppression can never be
// missed; a suppressed fire is a silent skip with a diagnostic.
func Evaluate(in EvalInput) EvalResult {
	threshold := in.FreshThreshold
	if threshold <= 0 {
		threshold = DefaultOperatorLoopFreshThreshold
	}
	res := EvalResult{NextCursor: in.Cursor.clone()}
	for _, e := range in.Entries {
		diag := func(reason, detail string) {
			res.Diags = append(res.Diags, Diagnostic{Server: in.Server, EntryID: e.ID, Reason: reason, Detail: detail})
		}

		if e.Muted {
			diag("muted", "entry is muted")
			continue
		}

		facts := in.Facts[e.ID]

		// Schedule predicate.
		schedDue := false
		rung := 0
		switch e.Schedule.Kind {
		case ScheduleEvery:
			schedDue, _ = everyDue(e, in.Log, in.Now)
		case ScheduleBackoff:
			switch {
			case !facts.Resolved():
				// Diagnosed below only if a fire would otherwise be due —
				// backoff due-ness is unknown without the epoch.
				diag("anchor-unavailable", "backoff target unresolved: "+facts.Unresolved)
			case facts.StateEpoch <= 0:
				diag("anchor-unavailable", "target pane carries no agent-state epoch")
			default:
				ladder := JoinAnchor(facts.StateEpoch, OwnDeliveries(in.Log, e.ID),
					e.Schedule.Min.Duration, e.Schedule.Max.Duration)
				schedDue = ladder.Due(in.Now, e.Schedule.Min.Duration, e.Schedule.Max.Duration)
				rung = ladder.Rung + 1
			}
		case ScheduleCron:
			diag("schedule-kind-unsupported", "cron schedule expressions are not yet supported")
		default:
			diag("unknown-schedule-kind", e.Schedule.Kind)
		}

		// Wake predicate (OR'd with the schedule).
		wakeDue := false
		if e.WakeOn != nil {
			if e.WakeOn.Event != WakeAgentStateChange {
				diag("unknown-wake-event", e.WakeOn.Event)
			} else {
				obs, hasObs := in.Cursor.Entries[e.ID]
				edge, next, wd := wakeEdge(e.WakeOn.Debounce.Duration, in.Fingerprint, obs, hasObs, in.Now)
				res.NextCursor.Entries[e.ID] = next
				if wd != "" {
					diag(wd, "wake_on "+WakeAgentStateChange)
				}
				wakeDue = edge
			}
		}

		if !schedDue && !wakeDue {
			continue
		}

		if !facts.Resolved() {
			diag("target-unresolved", facts.Unresolved)
			continue
		}

		// Guards last — before the fire is emitted, never after.
		suppressed := false
		for _, g := range e.SuppressWhile {
			holds, known := guardHolds(g, in.Operator, in.Now, threshold)
			if !known {
				diag("unknown-guard", g)
				continue
			}
			if holds {
				diag("suppressed", "guard "+g+" holds")
				suppressed = true
				break
			}
		}
		if suppressed {
			continue
		}

		reason := FireSchedule
		if !schedDue {
			reason = FireWake
		}
		res.Fires = append(res.Fires, Fire{
			Server: in.Server,
			Entry:  e,
			Reason: reason,
			PaneID: facts.PaneID,
			Rung:   rung,
			At:     in.Now,
		})
	}
	return res
}
