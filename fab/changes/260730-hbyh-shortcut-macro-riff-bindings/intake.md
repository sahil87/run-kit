# Intake: Macro Shortcut Bindings over Riff Presets

**Change**: 260730-hbyh-shortcut-macro-riff-bindings
**Created**: 2026-07-30

## Origin

Conversational — same `/fab-discuss` session as `260730-g40a-keyboard-shortcut-registry-overlay` (this change is its explicit follow-up; the user chose to draft both together).

> User's raw ask: "Also should we be able to setup shortcuts like this:
> Cmd + N  [wt create --new-worktree --command \"/fab-dsicuss\"]
> Cmd + L  [wt create --new --command \"codex /loop\" \"@a\"]
> i.e. long commands /macros that get executes on typing certain shortcuts? Or should this be picked up as a separate change? Should this also be apart of the keyboard shorctcuts design though?"

Decisions from the discussion:

1. **Separate change, anticipated schema**: the base registry change (g40a) reserves an action `kind` slot (`"builtin" | "macro"`); this change ships the macro kind. User approved this sequencing explicitly.
2. **Macros target riff presets and palette action ids — never arbitrary shell strings.** Rationale accepted in discussion: a shortcut executing user-typed shell text means a web-reachable endpoint running arbitrary commands, exactly what Constitution I exists to prevent. Both of the user's motivating examples are expressible as `rk riff` invocations (worktree/window spawn + launch command + pane args), and `POST /api/riff` already exists as a validated, argv-sliced, timeout-guarded seam.
3. The reviewed design mock (g40a's `design-mock.html`) shows the target UI: a CUSTOM section in the shortcuts overlay with macro rows (binding + preset command preview) and a "+ bind a key to a palette action or riff preset…" row.

## Why

The highest-value shortcuts for an operator are not built-ins — they are the operator's own repeated flows: "spawn a worktree with a fab-discuss agent", "spawn a codex loop in window @a". Today those are multi-step CLI invocations (`rk riff` / `wt create`) that cannot be reached from the web UI keyboard at all. Binding them to keys turns run-kit from a viewer into a launcher.

If we don't do this: users script around the UI in tmux, and the shortcut system's CUSTOM tier (already designed into the overlay) stays an empty promise.

Why riff-preset targets instead of raw command strings: the riff engine (`internal/riff`, `POST /api/riff`, fabconfig presets/tiers) already owns spawn-shaping, validation, and security discipline. Reusing it means macros add **zero** new process-execution surface — a macro is just a keyboard route to an existing, validated spawn. Arbitrary-shell macros were considered and rejected on Constitution I grounds.

## What Changes

### 1. Macro action kind in the registry

Extends g40a's registry schema (this change depends on g40a landing first):

```ts
type MacroAction = {
  actionId: string;            // "macro:<user-slug>"
  kind: "macro";
  label: string;               // user-provided, shown in overlay + palette
  target:
    | { type: "riff"; preset: string; args?: string[] }   // → POST /api/riff
    | { type: "palette"; paletteActionId: string };        // → invoke existing palette action
};
```

The user's two examples, expressed in this model (presets defined in fabconfig, where riff presets already live):

- ⇧⌘D → `{ type: "riff", preset: "discuss" }` — preset encodes worktree creation + `/fab-discuss` launch command
- ⇧⌘G → `{ type: "riff", preset: "codex-loop", args: ["@a"] }` — preset encodes the `codex /loop` launcher; pane arg passes through riff's argv-ordered pane array

### 2. Persistence

Macro definitions are per-device, alongside the override layer: `localStorage["runkit-macros"]` (array of MacroAction) + their bindings in the existing `runkit-keybindings` diff map. No backend storage — the *presets* live server-side in fabconfig (existing mechanism); the *bindings to keys* are client preference. Constitution II holds.

### 3. Overlay CUSTOM section becomes editable

- "+ add binding" flow: pick a target (searchable list = riff presets fetched from the existing fabconfig read seam + all palette actions), name it, capture a key.
- Macro rows render the resolved command preview (as in the mock: `rk riff --preset discuss`), delete + rebind affordances.
- Macro actions also appear in the command palette (kind-tagged), so they are reachable without their key.

### 4. Execution path

- `{ type: "palette" }` targets dispatch the existing palette action in-place — pure frontend.
- `{ type: "riff" }` targets call `POST /api/riff` with `{ preset, args }` exactly as the spawn-agent dialog / riff web frontend does today. Success/failure surfaces as the existing toast pattern; no fire-and-forget.
- No new backend endpoint, no new exec surface. If a preset named in a macro no longer exists in fabconfig, the macro row shows an error state and the key does nothing (no silent fallback).

## Affected Memory

- `run-kit/rk-riff`: (modify) note the web keyboard-macro consumer of presets + `POST /api/riff`
- `run-kit/ui-patterns`: (modify) CUSTOM macro section of the shortcuts overlay, palette exposure of macro actions

## Impact

- `app/frontend/src/lib/` — macro types + resolver extension of g40a's registry module
- `app/frontend/src/components/` — shortcuts-overlay CUSTOM section (add/edit/delete), palette integration
- `app/frontend/src/api/client.ts` — reuse existing riff/preset endpoints (read presets, POST spawn); add thin wrappers only if missing
- `app/frontend/tests/` — e2e for add-macro → keypress → riff POST (mocked, with `.spec.md` companion); unit tests for macro resolution + missing-preset error state
- No Go backend changes expected; if the preset-list read seam turns out not to be exposed over HTTP yet, a read-only GET is in scope (derive-from-fabconfig, Constitution II/X compliant)

## Open Questions

- Should macro definitions be exportable/shareable across devices in v1, or is per-device localStorage enough? (Default assumption: per-device; export rides g40a's later export/import.)
- Do riff presets as they exist today fully express both motivating examples (launch command + pane-target arg), or does the preset schema need a small extension first? Needs verification against `internal/riff` during planning.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Macro targets are riff presets + palette action ids only — no arbitrary shell strings | Constitution I; reasoning presented and accepted in discussion; both motivating examples expressible via riff | S:85 R:75 A:95 D:85 |
| 2 | Certain | Depends on g40a's registry `kind` slot; ships as its own change | User explicitly approved the two-change split | S:90 R:80 A:95 D:95 |
| 3 | Confident | v1 references existing fabconfig presets; no preset-creation UI in the web app | Minimal Surface Area (Constitution IV); presets already have a home + authoring path in fabconfig | S:50 R:85 A:70 D:60 |
| 4 | Tentative | Current riff preset schema can express both motivating examples (launch command + pane-target passthrough) without extension | Inferred from rk-riff memory (presets, argv-ordered pane arrays, `--print` launcher resolution) but not verified against `internal/riff` source | S:40 R:70 A:35 D:45 |
| 5 | Confident | Macro definitions persist in per-device localStorage; execution reuses `POST /api/riff` with no new backend surface | Constitution II; mirrors g40a's override-layer decision; existing endpoint already validated | S:60 R:80 A:80 D:70 |

5 assumptions (2 certain, 2 confident, 1 tentative, 0 unresolved).
