package cron

import (
	"crypto/rand"
	"fmt"
	"time"

	"gopkg.in/yaml.v3"

	"rk/internal/tmux"
)

// schema.go — the cron entry schema (docs/specs/cron.md § Cron State). Entry
// files are INTENT: runtime facts (last_fired, next_fire, backoff rung,
// orphaned-since) are NEVER fields here — they derive from the delivery log,
// the pane agent-state option, and the wake cursor.

// Schedule kinds.
const (
	ScheduleEvery   = "every"
	ScheduleBackoff = "backoff"
	ScheduleCron    = "cron" // recognized, never evaluated in this change (C9)
)

// Target kinds.
const (
	TargetRole    = "role"
	TargetSession = "session"
	TargetPane    = "pane"
)

// The only role target currently defined (the @rk_win_role radio's closed set).
const RoleOperator = "operator"

// Wake events.
const (
	WakeAgentStateChange = "agent-state-change"
	WakeScopeServer      = "server"
)

// Guard names (suppress_while).
const (
	GuardOperatorLoopFresh = "operator-loop-fresh"
	GuardNothingTracked    = "nothing-tracked"
)

// Delivery / absence policies (carried, not enforced — C3 owns enforcement).
const (
	DeliverImmediate = "immediate"
	DeliverWhenIdle  = "when-idle"

	IfAbsentSkip    = "skip"
	IfAbsentNotify  = "notify"
	IfAbsentRespawn = "respawn"
)

// Duration is a time.Duration that YAML-marshals as a Go duration string
// ("60s", "30m") per the spec's schema.
type Duration struct {
	time.Duration
}

// UnmarshalYAML parses a time.ParseDuration string; anything else is a
// per-entry validation failure (the tolerant load skips the entry).
func (d *Duration) UnmarshalYAML(value *yaml.Node) error {
	var s string
	if err := value.Decode(&s); err != nil {
		return fmt.Errorf("duration must be a string like \"60s\" or \"30m\"")
	}
	v, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("bad duration %q: %w", s, err)
	}
	d.Duration = v
	return nil
}

// MarshalYAML emits the time.Duration string form.
func (d Duration) MarshalYAML() (any, error) {
	return d.String(), nil
}

// Schedule is the entry's timing predicate. every carries Interval; backoff
// carries Anchor ("operator-idle" — the target pane's idle epoch) + Min + Max;
// cron carries a 5-field Expr that this change never evaluates.
type Schedule struct {
	Kind     string   `yaml:"kind"`
	Interval Duration `yaml:"interval,omitempty"`
	Anchor   string   `yaml:"anchor,omitempty"`
	Min      Duration `yaml:"min,omitempty"`
	Max      Duration `yaml:"max,omitempty"`
	Expr     string   `yaml:"expr,omitempty"`
}

// WakeOn is the edge trigger OR'd with the schedule: fire when the named
// transition occurred, debounced so a burst coalesces into at most one fire.
type WakeOn struct {
	Event    string   `yaml:"event"`
	Scope    string   `yaml:"scope,omitempty"`
	Debounce Duration `yaml:"debounce,omitempty"`
}

// Target names whom the payload is delivered to, resolved at fire time.
type Target struct {
	Kind    string `yaml:"kind"`
	Role    string `yaml:"role,omitempty"`
	Session string `yaml:"session,omitempty"`
	Pane    string `yaml:"pane,omitempty"`
}

// CreatedBy records provenance; At is the pre-delivery anchor for `every`.
type CreatedBy struct {
	Session string `yaml:"session,omitempty"`
	Pane    string `yaml:"pane,omitempty"`
	At      int64  `yaml:"at"`
}

// Entry is one cron intent record.
type Entry struct {
	ID            string    `yaml:"id"`
	Name          string    `yaml:"name,omitempty"`
	Schedule      Schedule  `yaml:"schedule"`
	WakeOn        *WakeOn   `yaml:"wake_on,omitempty"`
	SuppressWhile []string  `yaml:"suppress_while,omitempty"`
	Target        Target    `yaml:"target"`
	Payload       string    `yaml:"payload"`
	Deliver       string    `yaml:"deliver,omitempty"`
	IfAbsent      string    `yaml:"if_absent,omitempty"`
	Pinned        bool      `yaml:"pinned,omitempty"`
	Muted         bool      `yaml:"muted,omitempty"`
	CreatedBy     CreatedBy `yaml:"created_by,omitempty"`
}

// validate is the per-entry gate the tolerant load applies: a failing entry is
// skipped with a diagnostic, never failing the file.
func (e Entry) validate() error {
	if e.ID == "" {
		return fmt.Errorf("missing id")
	}
	switch e.Schedule.Kind {
	case ScheduleEvery:
		if e.Schedule.Interval.Duration <= 0 {
			return fmt.Errorf("every schedule needs a positive interval")
		}
	case ScheduleBackoff:
		if e.Schedule.Min.Duration <= 0 {
			return fmt.Errorf("backoff schedule needs a positive min")
		}
		if e.Schedule.Max.Duration < e.Schedule.Min.Duration {
			return fmt.Errorf("backoff max must be ≥ min")
		}
	case ScheduleCron:
		// Recognized, unevaluated here — schema-valid.
	case "":
		return fmt.Errorf("missing schedule kind")
	default:
		return fmt.Errorf("unknown schedule kind %q", e.Schedule.Kind)
	}
	switch e.Target.Kind {
	case TargetRole:
		if e.Target.Role == "" {
			return fmt.Errorf("role target needs a role")
		}
	case TargetSession:
		if e.Target.Session == "" {
			return fmt.Errorf("session target needs a session id")
		}
	case TargetPane:
		if !tmux.ValidPaneID(e.Target.Pane) {
			return fmt.Errorf("pane target needs a %%N pane id, got %q", e.Target.Pane)
		}
	default:
		return fmt.Errorf("unknown target kind %q", e.Target.Kind)
	}
	return nil
}

// idAlphabet for the rk-generated 4-char entry ids ("a3f9", "k7q2").
const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// newID generates a random 4-char entry id not present in taken.
func newID(taken map[string]bool) (string, error) {
	var buf [4]byte
	for attempt := 0; attempt < 64; attempt++ {
		if _, err := rand.Read(buf[:]); err != nil {
			return "", fmt.Errorf("generating entry id: %w", err)
		}
		id := make([]byte, 4)
		for i, b := range buf {
			id[i] = idAlphabet[int(b)%len(idAlphabet)]
		}
		if !taken[string(id)] {
			return string(id), nil
		}
	}
	return "", fmt.Errorf("generating entry id: id space exhausted")
}
