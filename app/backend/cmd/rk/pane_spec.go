package main

import (
	"strings"

	"github.com/spf13/pflag"

	"rk/internal/riff"
)

// The pane spec type + kind constants now live in internal/riff (the extracted
// engine). This file keeps the CLI's argv-parsing machinery (the repeatable
// --skill/--cmd flag grammar with bare / space / equals forms) and appends into
// a []riff.PaneSpec that the CLI hands to the engine.

// paneFlag is a pflag.Value implementation that supports three argv forms
// per occurrence of --skill or --cmd:
//
//  1. Bare (`--cmd`, next token is a flag or absent) — records an empty
//     Value, dispatches as a bare-shell / bare-claude pane.
//  2. Space-form (`--cmd htop`) — consumes the next argv token as Value
//     iff that token does not begin with `-` (short or long flag marker).
//  3. Equals-form (`--cmd=htop`) — pflag strips the `=` for us and calls
//     Set with the literal value.
//
// All occurrences across both flags append into a shared *[]PaneSpec so that
// argv order is preserved across interleaved --skill and --cmd uses. The
// shared slice is bound at init time by riff.go's flag registration.
//
// Supporting lookahead for space-form with optional value is why this custom
// Value is needed: pflag's built-in NoOptDefVal pattern produces bare-only
// behavior (no lookahead). See spec §Design Decisions #1.
type paneFlag struct {
	kind   string
	target *[]riff.PaneSpec
	// lookahead, when non-nil, reads the next argv token that pflag is
	// about to consume as this flag's space-form value. paneFlag cannot
	// itself see remaining argv (pflag's Value interface is value-only),
	// so we implement space-form by setting NoOptDefVal to a sentinel and
	// post-processing in a Cobra PreRunE. See riff.go.
}

// String returns the flag's "default value" shown in help. pflag requires
// Value to implement Stringer; returning "" keeps help text clean ("-s,
// --skill [...]" with no ugly "default: []" suffix).
func (p *paneFlag) String() string {
	return ""
}

// Set is called by pflag each time the flag appears in argv with a value.
// pflag strips any `=<value>` form and calls with the value only; for
// space-form, the space-form pre-processor (in riff.go) rewrites the argv
// to use the equals form before cobra parses. For the true bare form
// (next token is a flag), NoOptDefVal is set to a sentinel that Set
// recognizes and translates into an empty Value.
func (p *paneFlag) Set(v string) error {
	if p.target == nil {
		return nil
	}
	if v == paneBareSentinel {
		v = ""
	}
	*p.target = append(*p.target, riff.PaneSpec{Kind: p.kind, Value: v})
	return nil
}

// Type is the type-name shown in --help after the flag, e.g. "--skill <skill>".
func (p *paneFlag) Type() string {
	if p.kind == riff.PaneKindSkill {
		return "skill"
	}
	return "cmd"
}

// paneBareSentinel is the value pflag's NoOptDefVal assigns when the user
// writes `--skill` or `--cmd` with no value (e.g., the next argv token is
// another flag, or argv ends). paneFlag.Set translates it back to "" before
// storing. Chosen to be a string no user is likely to pass as a literal
// value; if someone does, they land in the bare-pane path — acceptable
// degenerate case.
const paneBareSentinel = "__rk_riff_pane_bare__"

// Ensure paneFlag satisfies pflag.Value at compile time.
var _ pflag.Value = (*paneFlag)(nil)

// rewritePaneSpaceForm walks argv and rewrites `--skill VALUE` / `--cmd VALUE`
// into `--skill=VALUE` / `--cmd=VALUE` when VALUE does not start with `-` and
// is not absent. The trailing `--` passthrough separator terminates rewriting;
// everything after `--` is preserved verbatim.
//
// This is the space-form pre-processor referenced by paneFlag: rewriting at
// argv level lets pflag's own parsing produce the two-form union (bare via
// NoOptDefVal, with-value via Set) that the flag visually promises.
//
// `--skill=x` and `-h=...` style args are pass-through (already using =-form).
// Bare `--skill` with no following token, or with a following token that
// starts with `-`, is left as-is — pflag's NoOptDefVal then fires and Set
// records the bare sentinel.
func rewritePaneSpaceForm(argv []string) []string {
	out := make([]string, 0, len(argv))
	sawSeparator := false
	for i := 0; i < len(argv); i++ {
		tok := argv[i]
		if sawSeparator {
			out = append(out, tok)
			continue
		}
		if tok == "--" {
			sawSeparator = true
			out = append(out, tok)
			continue
		}
		if isPaneBareFlag(tok) {
			// Bare form? Peek ahead.
			if i+1 < len(argv) {
				next := argv[i+1]
				// Next token is also a flag (starts with `-`, but not just `-`)
				// or is the `--` separator — leave tok bare.
				if next == "--" || strings.HasPrefix(next, "-") {
					out = append(out, tok)
					continue
				}
				// Consume next as the value, equals-form.
				out = append(out, tok+"="+next)
				i++
				continue
			}
			// argv ends — bare tok.
			out = append(out, tok)
			continue
		}
		out = append(out, tok)
	}
	return out
}

// isPaneBareFlag reports whether tok is exactly `--skill` or `--cmd` with no
// `=value` suffix and no shorthand. The exact-match check is deliberate:
// `--skills` or `--cmds` (if ever added) should not be pre-processed by this
// helper.
func isPaneBareFlag(tok string) bool {
	return tok == "--skill" || tok == "--cmd"
}
