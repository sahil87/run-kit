# Intake: OSC 8 Terminal Hyperlinks

**Change**: 260912-ojdq-osc8-terminal-hyperlinks
**Created**: 2026-09-12

## Origin

One-shot `/fab-new` invocation carrying the verdict of a completed, read-only investigation
(`FINDINGS.md`, 2026-09-12, produced in the `osc8-link-probe` worktree). The investigation was
controlled A/B against real captured bytes, not inference; every load-bearing claim below was
measured. The user's raw input:

> OSC 8 hyperlinks are stripped before reaching the dashboard, so markdown link text is not
> clickable. Claude Code correctly emits OSC 8 for both markdown links and bare URLs; bare URLs
> only appear to work because WebLinksAddon re-discovers them by regex over visible text. […]
> Summary of the two defects, both required: (1) tmux strips OSC 8 because the attached client
> never advertises the hyperlinks terminal-feature — `app/backend/api/terminals_ws.go:534`
> forceTERM pins `TERM=xterm-256color` and tmux's built-in terminal-features defaults for
> `xterm*` omit hyperlinks; fix is an additive `set -as terminal-features ',xterm-256color:hyperlinks'`
> beside the existing sync entry in `configs/tmux/default.conf`, `poweruser.conf` and `byobu.conf`
> (decide and state whether `simple.conf` should get it too); measured effect 0 → 4 OSC 8 sequences
> reaching the relay PTY. (2) `app/frontend/src/components/terminal-client.tsx:402-421` constructs
> Terminal with no `linkHandler`, so an arriving OSC 8 falls back to xterm's default `confirm()`
> dialog plus the blank-window `location.href` pattern this same file already documents as broken
> in the desktop shell at `:437-441`; fix is an explicit `linkHandler` routing through the same
> `window.open(uri,"_blank","noopener,noreferrer")` idiom used for WebLinksAddon at `:444`, ideally
> hoisting that opener into one shared local so the two paths cannot drift. Keep
> `allowNonHttpProtocols` unset to preserve the current safety posture. Watch for a duplicate
> underline/hover where the regex addon and the OSC 8 provider both match a bare URL, and
> smoke-test the SerializeAddon restore path at `:461`. Scope this tightly — it is roughly 12
> lines across four files. Take it through the full pipeline and open a PR.

**Decisions carried in from the user's input** (not re-litigated here): both defects are in
scope and both are required; `allowNonHttpProtocols` stays unset; the opener is hoisted into
one shared local; the change is scoped tightly to the two fixes plus their tests.

**Decision delegated to this intake**: whether `configs/tmux/simple.conf` also gets the line.
Decided below (§ What Changes → Change 1) — it does **not**, on documented in-repo precedent.

**Gap analysis** (run before the change folder was created): no existing mechanism covers OSC 8.
`grep -rn "linkHandler" app/frontend/src` has zero hits; `grep -rn "hyperlink\|OSC 8" docs/memory
docs/specs` returns nothing about link hyperlinks. One collision surfaced and is handled in
§ Affected Memory: `docs/memory/run-kit/ui/terminal.md` carries a Design Decision whose
**Rejected** row currently reads *"a custom `linkHandler` on the `Terminal` options **instead of**
the addon handler (reimplements the addon's URL detection for the same outcome)"*. That
rejection was correct for what it judged — a linkHandler as a *replacement* for the addon
handler — and stays correct; this change adds a linkHandler as a *complement* serving a source
the addon cannot see. The row must be re-scoped during hydrate, not silently contradicted.

## Why

**The problem.** Markdown link text rendered by an agent in a run-kit terminal pane is not
clickable. The user-visible symptom is narrow and easy to misread — bare URLs *are* clickable,
so the surface looks like it half-works — but the underlying breakage is total: **no OSC 8
hyperlink has ever reached the dashboard**. Bare URLs are clickable for an unrelated reason:
`WebLinksAddon` re-discovers them by running a regex over the plain visible text, which finds
`https://example.org` because the URL *is* its own link text. Markdown link text (`Example Site`)
contains no URL, so the regex finds nothing, and the OSC 8 that carried the real URL was stripped
two layers earlier. That is the complete and exact explanation of the reported symptom.

The upstream emitter is innocent and was ruled out empirically, so there is nothing to wait on:
Claude Code emits a well-formed `ESC ] 8 ; id=… ; URL BEL … ESC ] 8 ; ; BEL` pair for markdown
links and bare URLs *identically*, and its own tmux support gate whitelists tmux ≥ 3.4 (this box
runs 3.7c). Captured raw from a live pane via `tmux pipe-pane -o … | cat -v`:

```
See ^[]8;id=ags5vy;https://example.com^G^[[94mExample Site^[[20G^[]8;;^G and bare
    ^[]8;id=agseup;https://example.org^G^[[94mhttps://example.org^[[49G^[]8;;^G done.
```

**Two independent defects, either of which alone breaks the feature. Both must be fixed.**

*Defect 1 (primary) — tmux strips OSC 8 on the way out.* `forceTERM`
(`app/backend/api/terminals_ws.go:534`) pins the relay PTY to `TERM=xterm-256color`, which is
correct and stays. tmux re-emits a hyperlink from its grid **only** when the attached client's
terminal advertises the `hyperlinks` *terminal-feature*. No terminfo entry on this box carries
`Hls`, and tmux's built-in `terminal-features` defaults for `xterm*`
(`clipboard:ccolour:cstyle:focus:title`) do not include `hyperlinks` — so tmux silently drops it.
Controlled A/B, same pane, same grid, same `TERM`, PTY attach replicating
`terminals_ws.go:706-710` exactly:

| Run | `terminal-features` | link text reached PTY | OSC 8 reached PTY |
|-----|---------------------|-----------------------|-------------------|
| A — run-kit today | tmux default | yes (`INNERLINK` ×2) | **0** |
| B — one conf line added | `xterm-256color:hyperlinks` | yes (`INNERLINK` ×2) | **4** |

The hyperlink is provably in tmux's grid in *both* runs (`tmux capture-pane -e -p` shows
`^[]8;;https://example.com^[\INNERLINK^[]8;;^[\`), so this is emission-side stripping, not data
loss upstream. The relay itself is clean — PTY bytes reach the WebSocket unfiltered, with no
sanitizer in the path (`terminals_ws.go:710` onward).

`terminal-features` is a tmux **server** option. It cannot be set from `forceTERM`, which can only
set environment, and environment cannot carry it. The managed conf is the correct home.

*Defect 2 (latent — would bite the instant Defect 1 is fixed) — no `linkHandler`.* The
`new Terminal({…})` at `terminal-client.tsx:402-421` passes no `linkHandler`. xterm.js registers
its `OscLinkProvider` by default, so a surviving OSC 8 **is** parsed — but with `linkHandler` null
the provider's `activate` falls back to the library default:

```js
activate: (e,t) => r ? r.activate(e,t,d) : h(0,t)
// h(e,t){ if(confirm(`Do you want to navigate to ${t}? …WARNING: dangerous`)){
//   const e=window.open(); if(e){ e.opener=null; e.location.href=t } } }
```

That is a scary `confirm()` interstitial followed by the exact blank-window + `location.href`
pattern this same file already documents as broken in the desktop shell at `:438-443` (*"opens a
blank window and assigns location.href — inside the desktop shell that surfaces as 'about:blank'
(denied, link dead)"*). The existing `WebLinksAddon` handler at `:444-446` fixes this for the
addon's **own regex matches only**; it never touches the OSC 8 path. So fixing Defect 1 alone
would replace "link does nothing" with "link shows a dangerous-looking dialog and then dies in the
desktop shell" — strictly worse. Both fixes ship together or neither does.

**What happens if we don't fix it.** Every agent-emitted hyperlink stays dead. Agents increasingly
render PR links, docs links, and file references as markdown link text, which is precisely the form
that fails. The workaround — asking agents to print bare URLs — trades away the readable surface for
a mechanism that only ever worked by accident.

**Why this approach over alternatives.** The conf line is the only place a tmux *server* option can
live (env cannot carry it; `forceTERM` is the wrong altitude). The frontend `linkHandler` is the only
way to reach the OSC 8 activation path — it is a `Terminal` constructor option, not an addon seam, so
no addon configuration can substitute. Both defects were measured, not reasoned about.

## What Changes

Roughly 12 lines of production change across four files, plus tests.

### Change 1 — advertise the `hyperlinks` terminal-feature to tmux

**Files and sites** — one additive line beside each existing `sync` entry:

| File | Existing `sync` line | Action |
|------|----------------------|--------|
| `configs/tmux/default.conf` | `:36` | add the line (canonical; embedded) |
| `configs/tmux/poweruser.conf` | `:148` | add the line |
| `configs/tmux/byobu.conf` | `:165` | add the line |
| `configs/tmux/simple.conf` | — (no `terminal-features` block at all) | **no change** — see decision below |

**Exact line to add** (verified working; the append form matters):

```tmux
set -as terminal-features ',xterm-256color:hyperlinks'
```

`set -as` is append-mode, so this adds one feature and leaves `sync`, `extkeys`, and the
`RGB`/`Tc` `terminal-overrides` untouched. Verified after appending: the three existing feature
entries were unchanged. The line carries a short comment in each file matching that file's
existing comment density (`default.conf` and `poweruser.conf` comment their TUI-compat lines;
`byobu.conf` does not — match each file, do not impose one style).

**Decision — `simple.conf` does NOT get the line.** Three independent reasons, all documented
in-repo:

1. **Direct precedent.** The `260810-j93s-tmux-csi-u-extended-keys` change made the structurally
   identical call and recorded it verbatim in its plan: *"`simple.conf` does not enable extended
   keys and stays unchanged."* `simple.conf` has no `terminal-features` block, no
   `allow-passthrough`, and no `extended-keys` — it carries no TUI-compat section at all. Adding
   the first entry of a block this profile deliberately omits would make it the odd file out.
2. **It is not on any code path.** Only `default.conf` is embedded — `just _ensure-tmux-conf`
   copies it to `app/backend/build/tmux.conf` for the Go embed, and
   `cmd/rk/mcp_e2e_test.go:47` reads it directly. Nothing in the Go, TypeScript, or shell tree
   references `simple.conf`.
3. **It declares a different terminal.** `simple.conf` sets `default-terminal "tmux-256color"`
   and is the minimal/legacy profile by design.

(Mechanically the line *would* still work there — `terminal-features` keys on the attaching
client's `TERM`, which `forceTERM` pins to `xterm-256color` regardless of `default-terminal`. The
decision is about profile intent and precedent, not capability. It is one additive line to revisit
later if `simple.conf` is ever promoted.)

**Build copy.** `app/backend/build/tmux.conf` is a gitignored build artifact staged from
`configs/tmux/default.conf` by `just _ensure-tmux-conf` (a dependency of `just setup`,
`just test-backend`, and `just test-backend-race`). It is refreshed by running any of those — it
is **not** committed.

### Change 2 — give xterm.js an explicit `linkHandler`

**File**: `app/frontend/src/components/terminal-client.tsx`, the terminal-init effect.

Hoist the existing one-line opener out of the `WebLinksAddon` construction at `:444-446` into a
single shared local declared before `new Terminal({…})` at `:402`, then reference it from both
link paths so they cannot drift:

```ts
// Both link paths — the regex addon's matches and xterm's OSC 8 provider —
// open through this one opener. Passing the URI to window.open directly is
// load-bearing for the desktop shell: the library defaults open a URL-less
// blank window and assign location.href, which reaches setWindowOpenHandler
// as "about:blank" (denied, link dead).
const openLink = (uri: string) => {
  window.open(uri, "_blank", "noopener,noreferrer");
};
```

Then, inside the `new Terminal({…})` options object alongside `macOptionIsMeta` (`:420`):

```ts
// An OSC 8 hyperlink (agents emit these for markdown link text) activates
// through this handler. Without it xterm falls back to a confirm() dialog
// plus the same broken blank-window navigation. allowNonHttpProtocols stays
// unset: OscLinkProvider then refuses anything but http/https.
linkHandler: {
  activate: (_event, uri) => openLink(uri),
},
```

and the addon construction at `:444-446` collapses to reference the same local:

```ts
terminal.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));
```

**`allowNonHttpProtocols` stays unset** (user-directed, and it is the current safety posture):
xterm's `OscLinkProvider` refuses non-http/https protocols unless it is set, so leaving it unset
removes the `confirm()` interstitial and the dead about:blank path *without* widening what a pane
can ask the browser to open.

The `linkHandler` interface's other members (`hover`, `leave`) are optional and are deliberately
not implemented — xterm's default underline-on-hover is the wanted affordance.

### Change 3 — tests

1. **Frontend unit (`terminal-client.test.tsx`)** — a sibling to the existing
   `"TerminalClient clickable links (WebLinksAddon handler)"` describe block (`:1497-1542`),
   asserting the `Terminal` constructor receives a `linkHandler` whose `activate` calls
   `window.open` with the three-arg `(uri, "_blank", "noopener,noreferrer")` idiom. The existing
   block already reads the constructor args via `vi.mocked(Terminal).mock.calls[0]?.[0]` (see the
   `macOptionIsMeta` assertion at `:1492-1493`), so the mechanism is already in the file.
   **No e2e**: memory records the standing reason — xterm renders links on a canvas, so
   link-region clicks are not reliably automatable (`ui/terminal.md`
   § WebLinksAddon Explicit Handler).
2. **Go unit (`app/backend/internal/tmux/tmux_test.go`)** — a content assertion that the embedded
   default conf advertises the `hyperlinks` terminal-feature, mirroring the shape of the existing
   `TestDefaultConfigContainsSourceDirective` (`:2143`). This is the guard that the canonical conf
   and the Go embed do not drift apart on the one line this change exists for.

### Non-goals (explicit)

- **No change to `forceTERM`** (`terminals_ws.go:534`). `TERM=xterm-256color` is correct and is
  what `terminal-features` keys on. It is named in this intake only as the reason the feature must
  be advertised, never as a thing to edit.
- **No imperative `set -as terminal-features` on dial/attach.** The `SetExitEmptyOff` precedent
  (an option set imperatively on every dial because `-f` applies only at server birth) was
  considered and is not followed here — see § Impact → Deployment for why the existing
  managed-conf machinery already covers it, and § Assumptions row 6.
- **No suppression of the duplicate bare-URL match.** Both providers will now match a bare URL —
  see § Impact → Duplicate match.
- **No `allowNonHttpProtocols`.**
- **`simple.conf` unchanged** (decided above).

## Affected Memory

- `run-kit/ui/terminal`: (modify) Three edits. (a) The **Terminal Addons** table gains no new addon
  row, but the section text must record that the `Terminal` constructor now carries a
  `linkHandler` and that the shared `openLink` local is the single opener both link paths use.
  (b) A new subsection (beside § WebLinksAddon Explicit Handler) covering the OSC 8 path: why
  xterm's default activation is not viable, that `allowNonHttpProtocols` stays unset, and that
  bare URLs are now matched by both providers. (c) **Re-scope the existing Design Decision**
  *"Terminal link-opening is the SPA's job, via the shared `window.open` idiom"* — its **Rejected**
  row currently reads *"a custom `linkHandler` on the `Terminal` options **instead of** the addon
  handler (reimplements the addon's URL detection for the same outcome)"*. The rejection stays
  valid as written (a linkHandler as a *replacement*), but the file must no longer read as though
  a linkHandler is rejected outright: the two now coexist, covering two different link *sources* —
  the addon's regex over visible text, and xterm's OSC 8 provider. Left alone, this row would
  directly contradict the shipped code.
- `run-kit/configuration`: (modify) A Design Decision entry in § Design Decisions (the home of the
  managed conf's other option decisions — e.g. the `window-size smallest` / `aggressive-resize on`
  multi-viewer sizing guard) recording that the managed conf advertises the `hyperlinks`
  terminal-feature, why it must be a server option in the conf rather than env from `forceTERM`,
  and the deployment consequence (the body hash changes ⇒ managed-stale ⇒ force-write + reload
  sweep on next daemon start).

## Impact

**Code areas**

| Area | File | Scale |
|------|------|-------|
| tmux managed conf | `configs/tmux/default.conf` | +1 line (+comment) |
| tmux profiles | `configs/tmux/poweruser.conf`, `configs/tmux/byobu.conf` | +1 line each |
| Terminal frontend | `app/frontend/src/components/terminal-client.tsx` | ~8 lines net (hoist + `linkHandler`) |
| Frontend tests | `app/frontend/src/components/terminal-client.test.tsx` | one describe block |
| Backend tests | `app/backend/internal/tmux/tmux_test.go` | one content test |

Build artifact refreshed, not committed: `app/backend/build/tmux.conf` (via `just _ensure-tmux-conf`).

**Deployment** (important, and the reason this is a caveat rather than a defect). `tmux -f <conf>`
applies only when a client *starts* a server; an already-running server ignores the flag. run-kit
covers this two ways, both of which fire on a daemon restart — which shipping requires anyway:

1. `tmux.EnsureConfig()` at daemon start classifies the on-disk managed conf against the embed.
   This change alters the conf body, so the SHA-256 stamp no longer matches ⇒ **managed & stale**
   ⇒ force-write of the new embed ⇒ `tmux.RefreshSweep` reloads every live **managed** server.
2. `reloadConfigForAttach` (`terminals_ws.go:700`) reloads the conf on first WS attach, at most
   once per server per daemon lifetime, managed servers only.

Two consequences to state plainly rather than discover later: a **hand-edited** `~/.config/run-kit/
tmux.conf` is never written by rk (by design) and will not pick the line up — the doctor row is the
existing surface for that; and **externally-adopted servers** never receive rk's conf at all unless
adopted through `POST /api/servers/adopt`, so they keep dropping OSC 8 by design.

**Risks and side effects** (all carried from the investigation's own risk section)

- **Low blast radius.** `set -as` is append-mode and additive; the existing three feature entries
  and the `RGB`/`Tc` overrides were verified unchanged after appending.
- **Non-xterm.js clients on the same server.** `terminal-features` is server-wide and keyed on
  `TERM`. Another client attaching with `TERM=xterm-256color` from a terminal that genuinely lacks
  OSC 8 support (an old xterm, some CI capture, `script`) would now receive hyperlink escapes it
  does not understand. Most terminals ignore unknown OSC sequences harmlessly; a very old or strict
  emulator could print stray bytes. This only affects someone attaching to an rk-managed server by
  hand.
- **Duplicate match on bare URLs.** A bare URL will now be matched by *both* the regex addon and
  the OSC 8 provider. xterm resolves overlapping link providers by precedence, so the practical
  risk is a duplicate underline or hover artifact, **not** a double-open. Accepted as-is (removing
  `WebLinksAddon` is not an option — it is the only thing that linkifies output from programs that
  emit no OSC 8), and confirmed by one visual check rather than by code.
- **SerializeAddon.** Loaded at `:462` and driven from the tile layer (the tty export menu's
  snapshot row). Restoring a buffer containing OSC 8 is well-supported in xterm 6, but it is the
  one place worth a smoke test because run-kit drives it from a seam the library does not.
- **Copy/paste and `capture-pane` are unaffected** — hyperlinks live in a separate grid attribute,
  not in the cell text.
- **Change 2 narrows behavior, it does not widen it** — it removes the `confirm()` interstitial and
  the dead about:blank path while leaving `allowNonHttpProtocols` unset, so the set of protocols a
  pane can ask the browser to open is unchanged.

**Verification** (per `fab/project/code-quality.md` § Verification): `just test-backend`,
`cd app/frontend && npx tsc --noEmit`, `just test`, `just build`. Plus two manual checks that no
automated test covers: (a) a real OSC 8 hyperlink in a live pane is clickable and opens in a new
tab with no `confirm()` dialog, and the bare-URL case shows no duplicate-underline artifact;
(b) the tty export menu's snapshot row round-trips a buffer containing an OSC 8 hyperlink.

## Open Questions

None. The investigation resolved every mechanism question with measured evidence, the user's input
fixed the scope and the safety posture, and the one delegated decision (`simple.conf`) is settled
above on documented in-repo precedent. Two items are deliberately recorded as accepted risks rather
than questions: the duplicate bare-URL match and the non-xterm.js-client side effect.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `configs/tmux/simple.conf` does NOT get the `hyperlinks` line | Direct in-repo precedent: `260810-j93s` made the structurally identical call for `extended-keys-format` and recorded it ("`simple.conf` does not enable extended keys and stays unchanged"). simple.conf carries no TUI-compat block at all, is referenced by no code path, and declares `default-terminal tmux-256color` | S:80 R:95 A:85 D:75 |
| 2 | Certain | The line goes into all three TUI-compat-carrying profiles (`default`, `poweruser`, `byobu`), not just the embedded `default.conf` | User-directed, and consistent with how `sync` / `extkeys` / `extended-keys-format` are already carried in all three; only `default.conf` is embedded, but the other two are user-selectable profiles that would otherwise silently lack the feature | S:85 R:95 A:85 D:85 |
| 3 | Certain | `allowNonHttpProtocols` stays unset | Explicit user instruction and the current safety posture; xterm's `OscLinkProvider` then refuses anything but http/https, so the fix removes the dialog without widening what a pane can open | S:95 R:90 A:90 D:95 |
| 4 | Certain | The `window.open(uri,"_blank","noopener,noreferrer")` opener is hoisted into one shared local used by both the `linkHandler` and the `WebLinksAddon` handler | User-directed ("ideally hoisting…so the two paths cannot drift"); matches the codebase's universal external-open idiom already documented as load-bearing for the desktop shell | S:85 R:90 A:85 D:85 |
| 5 | Confident | The duplicate bare-URL match (regex addon + OSC 8 provider) is accepted, not suppressed; verified by one visual check | xterm resolves overlapping providers by precedence, so the risk is a duplicate underline/hover, not a double-open; removing WebLinksAddon is not viable (it is the only linkifier for non-OSC-8 output). Reversible if the artifact turns out to be visible | S:70 R:85 A:65 D:75 |
| 6 | Confident | No imperative `set -as terminal-features` on dial/attach; the conf is the only delivery vehicle | The `SetExitEmptyOff` precedent exists but is not needed: the body-hash change makes the conf managed-stale, so daemon start force-writes it and `RefreshSweep` reloads every live managed server — and shipping restarts the daemon anyway. Externally-adopted and hand-edited configs are stated caveats, not regressions. Also the user scoped the change tightly | S:80 R:80 A:75 D:70 |
| 7 | Confident | Test shape: one frontend unit test (sibling to the existing WebLinks handler block) + one Go conf-content test; no e2e | `code-quality.md` requires tests for changed behavior; memory records the standing reason there is no e2e for link clicks (xterm renders links on canvas). The Go test mirrors `TestDefaultConfigContainsSourceDirective` and guards conf↔embed drift on exactly the line this change adds | S:70 R:90 A:80 D:70 |
| 8 | Confident | The SerializeAddon OSC 8 round-trip is covered by a manual smoke test, not a new automated test | User asked for a smoke test; a real round-trip needs a real xterm instance, and the unit suite mocks the addon — an automated version would assert the mock, not the behavior | S:60 R:85 A:70 D:65 |
| 9 | Certain | `app/backend/build/tmux.conf` is refreshed via `just _ensure-tmux-conf` and NOT committed | It is gitignored (`.gitignore:183`) and staged by `just setup` / `just test-backend`; the `260909-3cp9` plan states the same ("build artifact, not committed") | S:75 R:90 A:90 D:80 |
| 10 | Confident | Hydrate must re-scope the `ui/terminal.md` Design Decision's "linkHandler instead of the addon handler" rejected row rather than leave it | The row as written would contradict the shipped code; its original judgment (linkHandler as a *replacement*) remains correct, so the fix is to scope it to replacement and record that the two coexist for two different link sources | S:75 R:75 A:80 D:75 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
