// Package fabconfig reads the riff presets from the fab/project/config.yaml
// file that lives at a repo root. It provides best-effort accessors that
// return empty values rather than errors when the file is absent, malformed,
// or missing keys — this mirrors the pattern used by internal/config for
// run-kit.yaml.
//
// The agent launcher is NOT read here: `rk riff` resolves it by shelling out
// to `fab agent --print` (see cmd/rk/riff.go resolveLauncher), so rk never
// parses fab-kit's tier→provider→session_command schema itself.
package fabconfig

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// fabConfigRelPath is the location of the fab config relative to the repo root.
const fabConfigRelPath = "fab/project/config.yaml"

// Pane-kind constants for PaneSpec.Kind. Exported so callers (cmd/rk/riff.go)
// can compare without stringly-typed literals.
const (
	PaneKindSkill = "skill"
	PaneKindCmd   = "cmd"
)

// PaneSpec is one pane in a preset's panes: list. Exactly one of Skill/Cmd
// is populated in a well-formed entry; Kind records which one was present
// so callers (rk riff) can dispatch without re-inspecting string emptiness
// (an empty Skill value is still a legitimate bare-skill pane).
type PaneSpec struct {
	Kind  string // PaneKindSkill or PaneKindCmd
	Skill string // populated when Kind == PaneKindSkill; may be empty
	Cmd   string // populated when Kind == PaneKindCmd; may be empty
}

// Preset is one preset's configuration. All fields are optional at the YAML
// level; empty slices/strings are meaningful (they mean "no preset opinion,
// fall back to CLI or built-in default" in the resolution chain).
type Preset struct {
	Layout string
	Panes  []PaneSpec
	WtArgs []string
}

// PresetEntry is a (name, preset) pair preserving YAML source order.
type PresetEntry struct {
	Name   string
	Preset Preset
}

// ReadPresets returns the map of named riff presets defined in
// <repoRoot>/fab/project/config.yaml under the top-level path
// riff.presets.<name>. It returns an empty (non-nil) map for any of:
//   - empty repoRoot
//   - missing file
//   - unreadable file
//   - malformed YAML
//   - missing riff or riff.presets block
//
// Individual preset entries are discarded (the containing preset is omitted)
// if any pane entry has both skill and cmd keys set. Other validation failures
// within a preset entry (unknown keys, etc.) are tolerated and ignored.
//
// This is best-effort and never returns an error or emits a log — a silent
// fallback so repo-scan callers don't get stderr noise from malformed configs.
func ReadPresets(repoRoot string) map[string]Preset {
	ordered := ReadPresetsOrdered(repoRoot)
	out := make(map[string]Preset, len(ordered))
	for _, kv := range ordered {
		out[kv.Name] = kv.Preset
	}
	return out
}

// ReadPresetsOrdered returns presets in the order they appear in the YAML
// file. Same silent-fallback posture as ReadPresets — returns nil on any
// failure path.
func ReadPresetsOrdered(repoRoot string) []PresetEntry {
	if repoRoot == "" {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(repoRoot, fabConfigRelPath))
	if err != nil {
		return nil
	}
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil
	}
	// Root is a DocumentNode wrapping one MappingNode.
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 {
		return nil
	}
	top := root.Content[0]
	if top.Kind != yaml.MappingNode {
		return nil
	}
	riffNode := findMappingValue(top, "riff")
	if riffNode == nil || riffNode.Kind != yaml.MappingNode {
		return nil
	}
	presetsNode := findMappingValue(riffNode, "presets")
	if presetsNode == nil || presetsNode.Kind != yaml.MappingNode {
		return nil
	}
	entries := make([]PresetEntry, 0, len(presetsNode.Content)/2)
	for i := 0; i+1 < len(presetsNode.Content); i += 2 {
		keyNode := presetsNode.Content[i]
		valNode := presetsNode.Content[i+1]
		if keyNode.Kind != yaml.ScalarNode {
			continue
		}
		preset, ok := decodePreset(valNode)
		if !ok {
			continue
		}
		entries = append(entries, PresetEntry{Name: keyNode.Value, Preset: preset})
	}
	return entries
}

// BuiltinTiers is the fixed set of fab-kit built-in tier names, in the canonical
// order (default first). It mirrors the FIXED stage→tier mapping documented in
// the fab config reference fence — these are always available even when the repo
// config defines no `agent.tiers` block.
var BuiltinTiers = []string{"default", "doing", "fast", "operator", "review"}

// ReadTiers returns the tier names available for a spawn: the union of fab-kit's
// built-in tiers (BuiltinTiers, in canonical order) and any additional names
// defined under `agent.tiers` in <repoRoot>/fab/project/config.yaml, appended in
// YAML source order and deduplicated. It is always non-empty (built-ins alone on
// an empty/absent/malformed config).
//
// Best-effort, same silent-fallback posture as ReadPresets: any read/parse
// failure yields exactly the built-ins with no error or log. Only the tier NAMES
// are read — rk never parses the tier profiles (provider/model/effort); those are
// resolved by shelling out to `fab agent <tier> --print`.
func ReadTiers(repoRoot string) []string {
	tiers := make([]string, 0, len(BuiltinTiers))
	seen := make(map[string]struct{}, len(BuiltinTiers))
	for _, name := range BuiltinTiers {
		tiers = append(tiers, name)
		seen[name] = struct{}{}
	}

	for _, name := range readConfiguredTierNames(repoRoot) {
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		tiers = append(tiers, name)
	}
	return tiers
}

// readConfiguredTierNames returns the `agent.tiers` map keys from the repo config
// in YAML source order, or nil on any failure path (silent-fallback).
func readConfiguredTierNames(repoRoot string) []string {
	if repoRoot == "" {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(repoRoot, fabConfigRelPath))
	if err != nil {
		return nil
	}
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil
	}
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 {
		return nil
	}
	top := root.Content[0]
	if top.Kind != yaml.MappingNode {
		return nil
	}
	agentNode := findMappingValue(top, "agent")
	if agentNode == nil || agentNode.Kind != yaml.MappingNode {
		return nil
	}
	tiersNode := findMappingValue(agentNode, "tiers")
	if tiersNode == nil || tiersNode.Kind != yaml.MappingNode {
		return nil
	}
	names := make([]string, 0, len(tiersNode.Content)/2)
	for i := 0; i+1 < len(tiersNode.Content); i += 2 {
		keyNode := tiersNode.Content[i]
		if keyNode.Kind == yaml.ScalarNode && keyNode.Value != "" {
			names = append(names, keyNode.Value)
		}
	}
	return names
}

// findMappingValue returns the value node whose sibling key equals key, or
// nil when no match exists. node must be a MappingNode.
func findMappingValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		k := node.Content[i]
		if k.Kind == yaml.ScalarNode && k.Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

// decodePreset converts a YAML mapping node into a Preset. Returns ok=false
// if the preset should be discarded (e.g., a pane entry has both skill and
// cmd keys). Unknown top-level keys are ignored; missing keys produce
// zero-value fields.
func decodePreset(node *yaml.Node) (Preset, bool) {
	var p Preset
	if node == nil {
		return p, false
	}
	// A null/empty scalar preset value is treated as all-defaults.
	if node.Kind == yaml.ScalarNode && (node.Tag == "!!null" || node.Value == "") {
		return p, true
	}
	if node.Kind != yaml.MappingNode {
		return p, false
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		keyNode := node.Content[i]
		valNode := node.Content[i+1]
		if keyNode.Kind != yaml.ScalarNode {
			continue
		}
		switch keyNode.Value {
		case "layout":
			if valNode.Kind == yaml.ScalarNode {
				p.Layout = valNode.Value
			}
		case "panes":
			panes, ok := decodePanes(valNode)
			if !ok {
				return Preset{}, false
			}
			p.Panes = panes
		case "wt_args":
			if valNode.Kind == yaml.SequenceNode {
				args := make([]string, 0, len(valNode.Content))
				for _, elt := range valNode.Content {
					if elt.Kind == yaml.ScalarNode {
						args = append(args, elt.Value)
					}
				}
				p.WtArgs = args
			}
		}
		// Unknown keys silently ignored.
	}
	return p, true
}

// decodePanes converts the value of a preset's `panes:` key into a slice of
// PaneSpec. Returns ok=false if any pane entry has both skill and cmd keys
// (signalling that the containing preset should be discarded).
func decodePanes(node *yaml.Node) ([]PaneSpec, bool) {
	if node == nil {
		return nil, true
	}
	// An empty list is fine.
	if node.Kind == yaml.ScalarNode && (node.Tag == "!!null" || node.Value == "") {
		return []PaneSpec{}, true
	}
	if node.Kind != yaml.SequenceNode {
		return nil, false
	}
	out := make([]PaneSpec, 0, len(node.Content))
	for _, entry := range node.Content {
		if entry.Kind != yaml.MappingNode {
			return nil, false
		}
		var spec PaneSpec
		hasSkill := false
		hasCmd := false
		for i := 0; i+1 < len(entry.Content); i += 2 {
			keyNode := entry.Content[i]
			valNode := entry.Content[i+1]
			if keyNode.Kind != yaml.ScalarNode {
				continue
			}
			switch keyNode.Value {
			case "skill":
				hasSkill = true
				if valNode.Kind == yaml.ScalarNode {
					spec.Skill = valNode.Value
				}
			case "cmd":
				hasCmd = true
				if valNode.Kind == yaml.ScalarNode {
					spec.Cmd = valNode.Value
				}
			default:
				// Unknown key inside a pane entry — discard entire preset
				// per spec: pane entries MUST have exactly one of
				// {skill, cmd} and no other keys.
				return nil, false
			}
		}
		if hasSkill && hasCmd {
			// Ambiguous pane — discard entire preset per spec.
			return nil, false
		}
		if hasSkill {
			spec.Kind = PaneKindSkill
		} else if hasCmd {
			spec.Kind = PaneKindCmd
		} else {
			// Entry has neither key — discard entire preset per spec
			// (pane entries MUST have exactly one of {skill, cmd}).
			return nil, false
		}
		out = append(out, spec)
	}
	return out, true
}
