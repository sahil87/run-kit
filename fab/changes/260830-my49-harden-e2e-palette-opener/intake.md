# Intake: Harden the E2E Command-Palette Opener

**Change**: 260830-my49-harden-e2e-palette-opener
**Created**: 2026-08-31

## Origin

Initiated conversationally. The user pointed at a CI job on PR #778 (run `33332965933`, job `99314758360`, E2E shard 1/4) and asked whether the errors in the log were expected. Triage found three things, only one a real signal:

1. `pty read error … file already closed`, `error: recipe 'dev' was terminated on line 31 by signal 15`, `ELIFECYCLE Command failed` — expected teardown noise. `scripts/test-e2e.sh:37` deliberately SIGTERMs the dev server's process group in its EXIT trap (`kill -- -$DEV_PGID`, the replacement for the old `kill 0` grenade). These print on every e2e run, pass or fail.
2. `compose-strip.spec.ts:830` — `375px mobile: the strip docks at the shell footer with no horizontal overflow (260813-j3jb)` — exceeded its own 60s `test.setTimeout` waiting on `getByRole("option", { name: "View: Text Input" })` after `page.keyboard.press("Meta+k")`. The palette never opened. `playwright.config.ts:12` sets `retries: 1`, the retry passed, the run reported `94 passed … 1 flaky` and every job stayed green.
3. Not a regression from #778 — that test already carried `test.setTimeout(60_000)` before the PR (`92858c6d^:app/frontend/tests/e2e/compose-strip.spec.ts:800`); #778 only shifted its line number 799 → 830.

The user then asked for a change to harden the opener.

> Harden the e2e command-palette opener — replace the bare `page.keyboard.press("Meta+k")` at ~30 call sites across ~20 e2e specs with a single shared helper in tests/e2e/_ready.ts that presses the chord, gates on the palette being visible, and retries a bounded number of times, so a lost chord fails fast with a clear message instead of hanging until the per-test timeout. […] The first task should determine the ACTUAL mechanism before settling the helper's shape […]. If (A) holds, flag whether the non-mac refusal gap is also a real product bug (Constitution V — the palette is the guaranteed keyboard fallback) and keep that question separate from this test-only change rather than folding a product fix in. Scope: e2e test infrastructure only.

**The mechanism was determined during intake** — it is (A), and it is now settled fact, not a hypothesis to re-derive. See § Why. This changes the helper's shape from what the raw prompt above described: a bare retry loop is NOT sufficient, because the failure is not transient once focus has landed in the terminal.

## Why

### The problem

38 call sites across 23 e2e spec files open the command palette with a bare, unguarded `await page.keyboard.press("Meta+k")` followed immediately by an assertion on palette content. When the chord is swallowed, the spec does not fail at the press — it hangs on the next locator until the per-test timeout expires (60s in the compose-strip case), then reports a misleading error naming the *option* it was waiting for rather than the *palette that never opened*.

### The mechanism (determined, not assumed)

The chord is swallowed when the xterm terminal owns focus at the moment of the press, on the Linux CI runner:

- `matchesCombo`'s `cmd` tier accepts **Meta OR Ctrl** on every platform (`app/frontend/src/lib/keybindings.ts:502`), so `Meta+k` matches the `command-palette` binding (`keybindings.ts:317`) even on Linux.
- `shouldRefuseTerminalChord` (`keybindings.ts:585-590`) refuses cmd-tier matches pressed with `metaKey` **on macOS only** — rule 2 is explicitly platform-gated, and the source comment records the intent: *"On Win/Linux this rule never applies (cmd-tier combos ARE plain-Ctrl chords there)"*.
- So on a Linux runner the terminal's `attachCustomKeyEventHandler` (`app/frontend/src/components/terminal-client.tsx:446`) does **not** refuse the key. xterm handles it, and `docs/memory/run-kit/ui/keyboard-and-palette.md:176` states the contract in the negative: *"xterm does not `preventDefault` a refused key, so the event bubbles to the window dispatcher"* — a key xterm **does** handle is `preventDefault`ed.
- `use-keybinding-dispatch.ts`'s first rule is `if (e.defaultPrevented) return`. The chord dies there. The palette never opens.

The registry is **not** the cause. `use-keybindings.ts` composes `DEFAULT_BINDINGS` with `readStoredOverrides()` (a synchronous `localStorage` read) — there is no async load. The existing comment at `terminal-export.spec.ts:32` (*"the keybinding registry may still be loading, so a lone Meta+k can be missed"*) is a **wrong diagnosis** and its 3× retry is a band-aid that happens to work only because focus usually moves away between attempts.

### Why it is flaky rather than constant

Whether the terminal owns focus at press time is a race against mount/focus timing, which is why the same call site passes ~94 runs out of 95. A bounded retry alone does not fix it — if focus is stably in the terminal, every attempt is swallowed identically and the test still burns its full timeout.

### Consequence of not fixing

Every one of the 38 sites is a latent 60s CI hang whose error message points at the wrong element. `retries: 1` currently masks these as "flaky" and keeps jobs green, so the cost is paid in wall-clock and in reviewer trust rather than in visible failures — until two attempts happen to lose the chord in the same run, at which point the shard fails with an error that names the wrong cause.

### Why this approach

One shared helper that (a) removes terminal focus before pressing, (b) gates on the palette actually being visible, and (c) retries a bounded number of times, converts a 60s misattributed hang into a fast failure that names the real condition. Homing it in `_ready.ts` follows the established plain-module helper precedent (`_tmux.ts`, `_boards.ts`) that `docs/memory/run-kit/architecture.md:813` records as the deliberate choice over a Playwright `test.extend` fixture.

## What Changes

### 1. New shared helper in `app/frontend/tests/e2e/_ready.ts`

Export an `openPalette(page): Promise<Locator>` that:

- Defocuses the terminal before pressing, so the chord cannot be consumed by xterm's key handler. The most direct form is a `page.evaluate` blurring the active element (`(document.activeElement as HTMLElement | null)?.blur()`); the implementation MAY instead click a known-inert chrome element if blurring proves insufficient — the requirement is that the tty helper textarea does not own focus at press time, not any particular means.
- Presses `Meta+k`.
- Waits for the palette input (`page.getByPlaceholder("Type a command")`) to become visible on a short per-attempt timeout (~3s, the value `terminal-export.spec.ts` already uses).
- Retries the whole press up to a small bound (3, matching the existing local helper).
- On exhaustion, fails with an assertion whose message names *the palette* — not whatever option the caller was about to look for.
- Returns the palette input locator, so callers can chain `.fill(...)` exactly as `terminal-export.spec.ts`'s local helper already does.

The helper carries a comment recording the real mechanism (terminal focus + mac-only cmd-tier refusal + `defaultPrevented`), replacing the wrong "registry may still be loading" explanation. Per `fab/project/code-quality.md` § Anti-Patterns the comment states the cross-file constraint, and cites no change ID or PR number.

### 2. Adopt it at the bare call sites

Convert the 38 `page.keyboard.press("Meta+k")` occurrences across these 23 files:

```
agent-next-waiting  boards-pin-flow  chat-view  code-surface  compose-strip
create-server-waiting  macro-riff-bindings  open-in-app  operator-compose
operator-digest  protected-kill-confirm  session-name-prompt  settings-dialog
shortcut-registry  sidebar-multiselect  sort-windows  spawn-agent
terminal-export  terminal-tile-find  top-bar-overflow  web-tile-find
web-tile-zoom  web-view-lens
```

**`shortcut-registry.spec.ts` is a deliberate exception to check first**: if any of its presses exist to exercise raw chord dispatch itself (rather than merely to reach the palette), converting them would destroy what the test proves. Inspect each of its sites and leave the ones testing dispatch alone, with a comment saying why.

### 3. Remove the local duplicate

Delete the local `openPalette` from `terminal-export.spec.ts:32-45` and its now-inaccurate comment; point its two callers at the shared helper. Update the "retried up to 3× — right after first paint the keybinding registry may still be loading" line in that file's test-intent JSDoc (`terminal-export.spec.ts:133`) to state the real reason, per the Test Intent Comments constraint in the constitution.

### 4. Test-intent comments stay in sync

Per the constitution's **Test Intent Comments** rule, any `test()` whose JSDoc `Steps:` list narrates "press `Meta+k`" must have that step updated to reflect the helper. This is a same-commit obligation, not follow-up work.

## Affected Memory

- `run-kit/architecture.md`: (modify) the `app/frontend/tests/e2e/_ready.ts` bullet (§ Testing layers, line ~916) enumerates the module's exports — add `openPalette` alongside `READY_TIMEOUT` / `gotoServerReady` / `gotoWindow` / `resolveWindow`.
- `run-kit/ui/keyboard-and-palette.md`: (modify) § Dispatch seams → Terminal seam (line ~176) — record the e2e consequence of rule 2 being mac-only: on the Linux rig a `Meta+k` reaching a focused xterm is handled and `preventDefault`ed, so specs must not press the palette chord under terminal focus. This is the durable cross-file fact the next person needs; it belongs beside the refusal rules it follows from.

## Impact

**Changed (test infrastructure only):**
- `app/frontend/tests/e2e/_ready.ts` — one new export
- 23 `*.spec.ts` files under `app/frontend/tests/e2e/` — call-site conversion + test-intent comment updates
- `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui/keyboard-and-palette.md` — at hydrate

**Deliberately unchanged:** all of `app/frontend/src/`. No product code, no `keybindings.ts` refusal rules, no `terminal-client.tsx` handler, no `playwright.config.ts` retry/timeout settings.

**Verification:** `just test-e2e` for the touched specs. Per `docs/memory/` (pane-worker green claims are scoped) a green claim must name which specs actually ran — the converted set is large, so the sibling specs touching the palette surface must be run, not assumed. Beware the known back-to-back `ECONNREFUSED` artifact when a second run starts during the first's teardown.

**Risk:** low and test-local — a broken helper fails loudly at every adopted site rather than silently passing. The main risk is over-converting `shortcut-registry.spec.ts` (§ What Changes 2).

## Open Questions

- **Is the non-mac cmd-tier refusal gap a real product bug, separate from this change?** On Linux and Windows the palette chord resolves to **Ctrl+K**, which `matchesCombo` matches on the `cmd` tier but `shouldRefuseTerminalChord` does not refuse (rule 2 is mac-only). A Linux user with terminal focus therefore sends Ctrl+K to the pane as kill-line and cannot open the palette from the keyboard. Constitution Principle V makes the palette the guaranteed keyboard fallback and requires every action be keyboard-reachable, so this looks like a genuine gap rather than only a test artifact — but the mac-only gating is deliberate and documented (plain-Ctrl chords belong to the pane on those platforms; refusing Ctrl+K would steal readline kill-line). Resolving it means choosing between two real costs and is a product decision, not a test one. **Explicitly out of scope here** — raised for the user to triage separately.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The lost chord is caused by xterm consuming `Meta+k` under terminal focus on the Linux rig (mechanism A), not by an async keybinding registry | Traced end-to-end in source during intake: `matchesCombo` cmd tier accepts Meta on all platforms (keybindings.ts:502); `shouldRefuseTerminalChord` rule 2 is mac-gated (keybindings.ts:589); memory states xterm does not preventDefault only a *refused* key (keyboard-and-palette.md:176); dispatcher drops `defaultPrevented` (use-keybinding-dispatch.ts). `use-keybindings.ts` reads localStorage synchronously — no async load | S:90 R:85 A:90 D:85 |
| 2 | Confident | The helper must DEFOCUS the terminal before pressing, not merely retry | Follows from #1: a bounded retry alone is a band-aid — if focus is stably in the terminal every attempt is swallowed identically and the test still burns its full timeout. The user's raw prompt described retry-only, but it predated the mechanism being determined | S:55 R:85 A:85 D:70 |
| 3 | Confident | Convert all 38 bare sites rather than only the terminal-route ones | One way to open the palette is the maintainable outcome, and it retires the wrong-diagnosis local copy in `terminal-export.spec.ts`; a partial conversion leaves the same latent hang at every site skipped, plus two competing idioms | S:65 R:80 A:80 D:65 |
| 4 | Confident | `_ready.ts` is the right home | Established plain-module precedent (`_tmux.ts`, `_boards.ts`); `architecture.md:813` records the deliberate rejection of a `test.extend` fixture for exactly this class of helper. Palette-opening is a readiness gate, which is what `_ready.ts` owns | S:60 R:90 A:85 D:75 |
| 5 | Confident | Retry bound 3, per-attempt wait ~3s | Adopts the values the existing local helper already runs in CI rather than inventing new ones | S:55 R:90 A:80 D:70 |
| 6 | Tentative | `shortcut-registry.spec.ts` sites may need to stay unconverted | Its subject is the chord registry itself, so some presses plausibly exercise raw dispatch rather than merely reaching the palette. Not yet inspected per-site — flagged as a first-task check rather than settled <!-- assumed: shortcut-registry may test raw chord dispatch; inspect each site before converting --> | S:40 R:70 A:55 D:45 |
| 7 | Certain | No product-code change in this change | User scoped it explicitly ("Scope: e2e test infrastructure only") and asked that the product question be kept separate | S:95 R:80 A:90 D:90 |

7 assumptions (3 certain, 3 confident, 1 tentative, 0 unresolved).
