package mcp

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// Resolved is a policy row paired with the live Cobra command it names. Resolve
// produces one per table row at startup; the resolved command supplies the
// flag usage strings that default input descriptions and is never executed.
type Resolved struct {
	Row Row
	Cmd *cobra.Command
	// flagUsage maps input name → the pflag usage of the flag the input maps
	// to, captured during resolution (input descriptions default to it).
	flagUsage map[string]string
}

// Resolve validates every row against the live Cobra tree — the drift guard
// (docs/specs/mcp.md § Policy table rules: a renamed or re-flagged verb fails
// the build, never the model). Introspection is read-only; no command runs.
// Every error names the offending row (and flag).
func Resolve(root *cobra.Command, table []Row) ([]Resolved, error) {
	seen := make(map[string]bool, len(table))
	resolved := make([]Resolved, 0, len(table))
	for _, row := range table {
		if seen[row.Tool] {
			return nil, fmt.Errorf("mcp policy row %q: duplicate tool name", row.Tool)
		}
		seen[row.Tool] = true
		if row.Tool == "" {
			return nil, fmt.Errorf("mcp policy row with path %q: empty tool name", row.Path)
		}
		for _, nt := range neverTools {
			if row.Path == nt || strings.HasPrefix(row.Path, nt+" ") {
				return nil, fmt.Errorf("mcp policy row %q: path %q is a never-tool and must not be exposed", row.Tool, row.Path)
			}
		}
		if row.Timeout < 0 || row.Timeout > ToolTimeoutCap {
			return nil, fmt.Errorf("mcp policy row %q: timeout %s exceeds the %s cap", row.Tool, row.Timeout, ToolTimeoutCap)
		}
		cmd, err := resolvePath(root, row)
		if err != nil {
			return nil, err
		}
		res := Resolved{Row: row, Cmd: cmd, flagUsage: map[string]string{}}
		for _, arg := range row.Args {
			if err := res.checkArg(cmd, arg); err != nil {
				return nil, err
			}
		}
		if err := row.checkConditionals(); err != nil {
			return nil, err
		}
		if row.Stdin != "" {
			if err := row.checkStdin(); err != nil {
				return nil, err
			}
		}
		resolved = append(resolved, res)
	}
	return resolved, nil
}

// resolvePath finds the row's command and confirms the match is exact — a
// partial Find (cobra falls back to a parent on unknown tokens) is a miss.
func resolvePath(root *cobra.Command, row Row) (*cobra.Command, error) {
	cmd, _, err := root.Find(strings.Fields(row.Path))
	if err != nil {
		return nil, fmt.Errorf("mcp policy row %q: path %q does not resolve: %w", row.Tool, row.Path, err)
	}
	if want := root.Name() + " " + row.Path; cmd == nil || cmd.CommandPath() != want {
		got := ""
		if cmd != nil {
			got = cmd.CommandPath()
		}
		return nil, fmt.Errorf("mcp policy row %q: path %q does not resolve (found %q)", row.Tool, row.Path, got)
	}
	return cmd, nil
}

// checkArg verifies one Arg against the command: a Flag or flag-shaped
// Literal must exist on the command (local or inherited), and a Flag's pflag
// type must be compatible with the input's type. Positional and stdin-only
// inputs have no flag to check.
func (r *Resolved) checkArg(cmd *cobra.Command, arg Arg) error {
	name := arg.Name
	if name == "" {
		name = fmt.Sprintf("literal %q", arg.Literal)
	}
	switch {
	case arg.Flag != "":
		flag := lookupFlag(cmd, arg.Flag)
		if flag == nil {
			return fmt.Errorf("mcp policy row %q: flag %q not found on %q", r.Row.Tool, arg.Flag, cmd.CommandPath())
		}
		if err := checkFlagType(r.Row.Tool, arg, flag); err != nil {
			return err
		}
		r.flagUsage[arg.Name] = flag.Usage
	case arg.Literal != "" && strings.HasPrefix(arg.Literal, "-") && arg.Literal != "-":
		// Flag-shaped literals ("--json") are how drift in a fixed flag would
		// otherwise slip through; "-" (stdin marker) is exempt.
		if lookupFlag(cmd, arg.Literal) == nil {
			return fmt.Errorf("mcp policy row %q: literal flag %q not found on %q", r.Row.Tool, arg.Literal, cmd.CommandPath())
		}
	}
	return nil
}

// lookupFlag finds a flag by long name ("--all") or shorthand ("-L") on the
// command's local flags or its inherited (parent persistent) flags — a parent's
// persistent flag is not in cmd.Flags() until merged.
func lookupFlag(cmd *cobra.Command, flag string) *pflag.Flag {
	if strings.HasPrefix(flag, "--") {
		if f := cmd.LocalFlags().Lookup(strings.TrimPrefix(flag, "--")); f != nil {
			return f
		}
		return cmd.InheritedFlags().Lookup(strings.TrimPrefix(flag, "--"))
	}
	short := strings.TrimPrefix(flag, "-")
	if f := cmd.LocalFlags().ShorthandLookup(short); f != nil {
		return f
	}
	return cmd.InheritedFlags().ShorthandLookup(short)
}

// checkFlagType rejects a row whose input type the target pflag cannot carry.
func checkFlagType(tool string, arg Arg, flag *pflag.Flag) error {
	ok := false
	switch flag.Value.Type() {
	case "bool":
		ok = arg.Type == ArgBoolean
	case "int", "int64":
		ok = arg.Type == ArgInteger
	case "string":
		ok = arg.Type == ArgString
	case "stringArray":
		// A string input maps onto one element of a repeatable flag (`--key`).
		ok = arg.Type == ArgString
	default:
		// An unlisted pflag type is incompatible by default — widen here only
		// when a row genuinely needs it.
	}
	if !ok {
		return fmt.Errorf("mcp policy row %q: flag %q has type %q, incompatible with input %q", tool, arg.Flag, flag.Value.Type(), arg.Name)
	}
	return nil
}

// checkConditionals validates the When/Default/OneOf model additions: every
// When and OneOf member names a (non-literal) input of the row, and a Default
// rides only a Flag arg whose type can carry it — never a Boolean (a bare
// flag has no value to default), and an Integer default must parse.
func (r Row) checkConditionals() error {
	inputs := map[string]bool{}
	for _, arg := range r.Args {
		if arg.Literal == "" && arg.Name != "" {
			inputs[arg.Name] = true
		}
	}
	for _, arg := range r.Args {
		if arg.When != "" && !inputs[arg.When] {
			return fmt.Errorf("mcp policy row %q: literal %q gates on %q, which is not an input of the row", r.Tool, arg.Literal, arg.When)
		}
		if arg.Default == "" {
			continue
		}
		if arg.Flag == "" || arg.Type == ArgBoolean {
			return fmt.Errorf("mcp policy row %q: input %q has a default but is not a string/integer flag", r.Tool, arg.Name)
		}
		if arg.Type == ArgInteger {
			if _, err := strconv.Atoi(arg.Default); err != nil {
				return fmt.Errorf("mcp policy row %q: input %q default %q is not an integer", r.Tool, arg.Name, arg.Default)
			}
		}
	}
	for _, name := range r.OneOf {
		if !inputs[name] {
			return fmt.Errorf("mcp policy row %q: one_of member %q is not an input of the row", r.Tool, name)
		}
	}
	return nil
}

// checkStdin verifies Row.Stdin names a string input of the row — a send body
// travels on stdin, never argv. An optional (non-required) stdin input must be
// a OneOf member: otherwise a missing body would exec the verb with no payload.
func (r Row) checkStdin() error {
	for _, arg := range r.Args {
		if arg.Name == r.Stdin {
			if arg.Type != ArgString {
				return fmt.Errorf("mcp policy row %q: stdin input %q must be a string", r.Tool, r.Stdin)
			}
			if !arg.Required && !slices.Contains(r.OneOf, arg.Name) {
				return fmt.Errorf("mcp policy row %q: stdin input %q is optional but not a one_of member", r.Tool, r.Stdin)
			}
			return nil
		}
	}
	return fmt.Errorf("mcp policy row %q: stdin input %q is not an arg of the row", r.Tool, r.Stdin)
}

// InputSchema generates the tool's JSON-schema object from the row's args:
// types, required set, pattern/enum/bounds, and descriptions (the row's text,
// else the flag's pflag usage). additionalProperties is false — the handler
// rejects unknown inputs rather than silently dropping them.
func InputSchema(res Resolved) map[string]any {
	props := map[string]any{}
	var required []string
	for _, arg := range res.Row.Args {
		if arg.Literal != "" {
			continue
		}
		prop := map[string]any{"type": schemaType(arg.Type)}
		if desc := arg.Description; desc != "" {
			prop["description"] = desc
		} else if usage := res.flagUsage[arg.Name]; usage != "" {
			prop["description"] = usage
		}
		if arg.Pattern != "" {
			prop["pattern"] = arg.Pattern
		}
		if len(arg.Enum) > 0 {
			prop["enum"] = arg.Enum
		}
		if arg.Minimum != nil {
			prop["minimum"] = *arg.Minimum
		}
		if arg.Maximum != nil {
			prop["maximum"] = *arg.Maximum
		}
		if arg.Default != "" {
			// Typed default: a JSON number for Integer args, a string
			// otherwise (Resolve guarantees the parse).
			if arg.Type == ArgInteger {
				if n, err := strconv.Atoi(arg.Default); err == nil {
					prop["default"] = n
				}
			} else {
				prop["default"] = arg.Default
			}
		}
		props[arg.Name] = prop
		if arg.Required {
			required = append(required, arg.Name)
		}
	}
	schema := map[string]any{
		"type":                 "object",
		"properties":           props,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func schemaType(t ArgType) string {
	switch t {
	case ArgInteger:
		return "integer"
	case ArgBoolean:
		return "boolean"
	default:
		return "string"
	}
}

// ToolDescription is the row's override when set, else the command's Cobra
// Short + Long (docs/specs/mcp.md § Instructions and discovery: CLI help is
// never rewritten for the model; a row overrides when the prose misleads).
func ToolDescription(res Resolved) string {
	if res.Row.Description != "" {
		return res.Row.Description
	}
	return strings.TrimSpace(res.Cmd.Short + "\n\n" + res.Cmd.Long)
}
