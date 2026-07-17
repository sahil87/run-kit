# pane-register-panel.spec.ts

Verifies the **PANE panel's four-register view** (260706-y1ar;
`docs/specs/status-pyramid.md` § Row Minimalism): out (L0) / agt (L1) / fab (L2)
/ PR (L3) render as separate orthogonal lines, never collapsed, so the sidebar
StatusDot is a pure function of what the panel shows. The L0/L1 register keys are
fixed-width 3-char (`out`/`agt`, matching `tmx`/`cwd`/`git`) per 260706-4h26.
Absent layers render as absent; the L3 PR register shows for ANY pane with a
`prNumber` (ungated from `fabChange` — universal derivation, Principle X).

## Shared setup

- Fully mocked — no tmux, no `gh`, no real backend. Injected via `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200.
  - `/ws/state` (state socket, via `mockStateSocket`) → the subscribe ack + `sessions` event carry the mocked payload, session `dev` with
    three windows:
    - `@1` "full-stack" — all four layers: `agentState: waiting` (3m),
      `fabChange`/`fabStage: review`/`fabDisplayState: failed`, and a derived
      PR `#386`.
    - `@2` "plain-shell" — a bare shell (only L0 output).
    - `@3` "pr-only" — a plain pane (no `fabChange`) WITH a derived PR `#999`.
  - The terminals mux WebSocket (`/ws/terminals`) is stubbed.
- `beforeEach` installs the routes before navigation.

## Tests

### `a full window shows all four registers (out/agt/fab/PR)`

**What it proves:** every signal layer that exists for a window renders as its
own register line — out (L0), agt (L1, with the waiting duration), fab (L2,
change · stage), and PR (L3) — and the L0/L1 keys use the fixed-width 3-char
vocabulary (`out`/`agt`).

**Steps:**
1. Navigate to `/default/1`.
2. Assert the `register-output` (L0) test id is visible and contains the key
   text "out" as a whole token (`/\bout\b/`, not a bare substring — a regressed
   `output` key would still contain "out").
3. Assert the `register-agent` (L1) is visible and contains the key text "agt"
   and "waiting 3m".
4. Assert the fab register (L2) shows the change id ("y1ar") and stage
   ("review").
5. Assert the PR register (L3) `pr-line` contains "#386".

### `a plain shell shows only the output register (absent layers absent)`

**What it proves:** a bare shell pane (no agent, no change, no PR) renders only
the L0 output register — the agent/fab/PR registers are absent, not placeholder
rows.

**Steps:**
1. Navigate to `/default/2`.
2. Assert `register-output` is visible.
3. Assert `register-agent` has count 0 and the PR `pr-line` has count 0.

### `the PR register (L3) shows for a plain pane with a PR (universal derivation)`

**What it proves:** the L3 PR register is ungated from `fabChange` — a plain
pane on a branch with a PR still surfaces its PR in the panel (even though the
dot stays on the gray floor via D1).

**Steps:**
1. Navigate to `/default/3`.
2. Assert the PR `pr-line` contains "#999".
3. Assert the agent register has count 0 (no change bound, no agent).
