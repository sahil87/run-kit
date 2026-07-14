package riff

import (
	"fmt"
	"sort"
	"strings"

	"rk/internal/fabconfig"
)

// ResolveActivePreset determines which preset (if any) applies to a CLI
// invocation. Returns the preset, the remaining positional args after any
// preset consumption, and an error on ambiguous/unknown inputs. Exported so the
// CLI (which owns positional/flag parsing) can call it.
//
// Rules:
//   - Both --preset and a matching positional → error (mutually exclusive).
//   - --preset provided and unknown → error (lists defined presets).
//   - Positional matches a defined preset exactly → consume arg[0].
//   - Else no preset applies; args returned untouched.
func ResolveActivePreset(args []string, positionalCandidate, presetFlag string, available map[string]fabconfig.Preset) (*fabconfig.Preset, []string, error) {
	positionalMatch := positionalCandidate != "" && hasPreset(available, positionalCandidate)

	if presetFlag != "" && positionalMatch {
		return nil, args, fmt.Errorf("run-kit riff: positional preset %q and --preset %q are mutually exclusive", positionalCandidate, presetFlag)
	}
	if presetFlag != "" {
		p, ok := available[presetFlag]
		if !ok {
			return nil, args, fmt.Errorf("run-kit riff: unknown preset %q (defined: %s)", presetFlag, joinPresetNames(available))
		}
		return &p, args, nil
	}
	if positionalMatch {
		p := available[positionalCandidate]
		return &p, args[1:], nil
	}
	return nil, args, nil
}

func hasPreset(available map[string]fabconfig.Preset, name string) bool {
	_, ok := available[name]
	return ok
}

// joinPresetNames returns a comma-separated sorted list of preset names, or
// `(none)` if the map is empty.
func joinPresetNames(m map[string]fabconfig.Preset) string {
	if len(m) == 0 {
		return "(none)"
	}
	names := make([]string, 0, len(m))
	for k := range m {
		names = append(names, k)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

// composePanes maps the HTTP endpoint's (task, preset) pair to the CLI-pane
// input for ResolveEffectiveSpec — the endpoint's task-injection composition
// rules (R6/R7), as a pure, table-testable seam:
//
//   - task non-empty            → a single skill pane carrying the task as its
//     launcher positional arg. This REPLACES any preset panes (per
//     ResolveEffectiveSpec rule 1); the preset still contributes layout+wt_args.
//   - task empty, preset panes  → nil CLI panes, so ResolveEffectiveSpec falls
//     through to the preset's own panes.
//   - task empty, no preset panes → a single BARE skill pane (the endpoint's
//     blank-agent default — deliberately NOT the CLI's /fab-discuss change-2
//     fallback, which only fires when NO cliPanes are supplied).
//
// A nil returned slice means "let the preset/default decide"; a non-nil slice
// means "these panes replace the preset's".
func composePanes(task string, preset *fabconfig.Preset) []PaneSpec {
	switch {
	case task != "":
		return []PaneSpec{{Kind: PaneKindSkill, Value: task}}
	case preset == nil || len(preset.Panes) == 0:
		return []PaneSpec{{Kind: PaneKindSkill, Value: ""}}
	default:
		return nil
	}
}

// ResolveEffectiveSpec merges CLI-style panes with an optional preset into an
// EffectiveSpec. Resolution order per field:
//
//	panes:   CLI (replaces) > preset > built-in default single-pane
//	layout:  explicit layout (incl. "auto") > preset > default auto-by-count
//	count:   CLI count
//	wt args: preset wt_args prepended to CLI passthrough
//
// layoutExplicit distinguishes "user didn't set a layout" from "user explicitly
// chose auto" — the latter overrides a preset layout, the former defers to it.
// Single-pane windows have their layout forced empty regardless of source.
//
// NOTE: the "no panes anywhere → single DefaultRiffSkill pane" default is the
// CLI's change-2 compatibility fallback. Spawn (the HTTP path) supplies its own
// cliPanes (a bare or task skill pane) BEFORE calling this, so it never reaches
// that fallback — the endpoint's blank-agent default is a bare launcher, not
// /fab-discuss.
func ResolveEffectiveSpec(cliPanes []PaneSpec, layoutExplicit bool, layoutCanonical string, cliCount int, preset *fabconfig.Preset, passthrough []string) (EffectiveSpec, error) {
	spec := EffectiveSpec{Count: cliCount}

	switch {
	case len(cliPanes) > 0:
		spec.Panes = append(spec.Panes, cliPanes...)
	case preset != nil && len(preset.Panes) > 0:
		for _, p := range preset.Panes {
			spec.Panes = append(spec.Panes, presetPaneToSpec(p))
		}
	default:
		spec.Panes = []PaneSpec{{Kind: PaneKindSkill, Value: DefaultRiffSkill}}
	}

	switch {
	case layoutExplicit:
		if layoutCanonical == "auto" {
			spec.Layout = autoLayout(len(spec.Panes))
		} else {
			spec.Layout = layoutCanonical
		}
	case preset != nil && preset.Layout != "":
		canonical, err := ResolveLayout(preset.Layout)
		if err != nil {
			return EffectiveSpec{}, &ExitCodeError{Code: ExitValidation, Msg: fmt.Sprintf("run-kit riff: preset layout invalid: %v", err)}
		}
		spec.Layout = canonical
	default:
		spec.Layout = autoLayout(len(spec.Panes))
	}

	if len(spec.Panes) <= 1 {
		spec.Layout = ""
	}

	if preset != nil && len(preset.WtArgs) > 0 {
		spec.Passthrough = append(spec.Passthrough, preset.WtArgs...)
	}
	spec.Passthrough = append(spec.Passthrough, passthrough...)

	return spec, nil
}

// presetPaneToSpec converts an fabconfig.PaneSpec (YAML-layer, separate
// Skill/Cmd fields) into the engine PaneSpec (single Value dispatched by Kind).
func presetPaneToSpec(p fabconfig.PaneSpec) PaneSpec {
	out := PaneSpec{Kind: p.Kind}
	switch p.Kind {
	case fabconfig.PaneKindSkill:
		out.Value = p.Skill
	case fabconfig.PaneKindCmd:
		out.Value = p.Cmd
	}
	return out
}
