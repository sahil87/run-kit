# tmux User-Option Scope Naming — `@rk_<scope>_<name>` + Legacy Sweep

**Drafted**: 2026-08-28 · against `5bace0f3` · triggered by the `fabKit` session's stray `@color slate` leaking into every window in it
**Shape**: 4 changes across 2 repos — run-kit (3) and fab-kit (1)
**Rule of record**: `fab/project/context.md` § Conventions (one name, one scope) · registry: `docs/memory/run-kit/tmux-sessions.md` § Server-Scoped User Options

## Diagnosis

tmux format expansion resolves `#{@foo}` by walking **pane → window → session → global**. A user option set at an outer scope therefore shows up in every inner-scope read, and the inner-scope clear (`set-option -wu`) removes nothing because the inner scope never held it. The live symptom: `fabKit` (server `fabKit1`) carries a pre-split session-scoped `@color slate`; every window row in that session renders slate and the window picker's "clear color" is a no-op.

The current 22 options already avoid same-name/different-scope collisions, but the naming gives no help holding that invariant:

- two keys sit outside the `@rk_` namespace (`@color`, `@session_color`) — any tmux plugin or user conf can collide;
- scope is unreadable from the name (`@rk_role` window vs `@rk_origin` server vs `@rk_chat` pane look identical);
- the pin-session trio (`@rk_board`/`@rk_home`/`@rk_board_order`) is named for the concept, not the carrier;
- `@rk_type` and `@rk_home` are generic; `@rk_ctl_keepalive` has no reader.

Target scheme: **`@rk_<scope>_<name>`**, scope ∈ `srv` · `ses` · `win` · `pane`. Sorts by scope in `show-options`, self-documents the invariant.

### Target map

| Current | Target | Scope | Writers outside rk? |
|---|---|---|---|
| `@color` | `@rk_win_color` | window | no |
| `@session_color` | `@rk_ses_color` | session | no |
| `@rk_type` | `@rk_win_lens` | window | no |
| `@rk_url` | `@rk_win_url` | window | no |
| `@rk_present_root` | `@rk_win_present_root` | window | no |
| `@rk_marker` | `@rk_win_marker` | window | no |
| `@rk_flair` | `@rk_win_flair` | window | no |
| `@rk_note` | `@rk_win_note` | window | agents/operator via `set-option -wt "$TMUX_PANE"` (documented convention) |
| `@rk_role` | `@rk_win_role` | window | no (fab-operator self-mark goes through `rk role`) |
| `@rk_session_flair` | `@rk_ses_flair` | session | no |
| `@rk_board` | `@rk_ses_pin_board` | session (`_rk-pin-*`) | no |
| `@rk_home` | `@rk_ses_pin_home` | session (`_rk-pin-*`) | no |
| `@rk_board_order` | `@rk_ses_pin_order` | session (`_rk-pin-*`) | no |
| `@rk_ctl_keepalive` | **delete** | session (`_rk-ctl`) | no (no reader either) |
| `@rk_session_order` | `@rk_srv_session_order` | server | no |
| `@rk_server_rank` | `@rk_srv_rank` | server | no |
| `@rk_origin` | `@rk_srv_origin` | server | no |
| `@rk_managed` | `@rk_srv_managed` | server | no |
| `@rk_ephemeral` | `@rk_srv_ephemeral` | server | **yes** — `scripts/test-e2e.sh`, Playwright `_tmux.ts`, agents |
| `@rk_protected` | `@rk_srv_protected` | server | **yes** — any creator by convention |
| `@rk_agent_state` | `@rk_pane_agent_state` | pane | **yes** — hooks installed by `rk agent setup`; **read by fab-kit** (`internal/pane/pane.go:25`, `cmd/fab/pane_map.go:360`) |
| `@rk_chat` | `@rk_pane_chat` | pane | **yes** — hooks installed by `rk agent setup` |

### Facts that shape the plan (verified at `5bace0f3`)

- **Snapshots need no on-disk migration.** `internal/snapshot` stores struct fields (`win.Color`, `win.Role`, …) and `restore.go:335-341` maps them to option names at restore time — only the restore-side literals change.
- **fab-kit reads exactly one key**: `@rk_agent_state`. Its `@rk_role`/`@rk_url`/`@rk_type` mentions are docs/skill prose only.
- **Hook scripts** live in `app/backend/internal/installers` + `cmd/rk/agent*.go`; users pick up new hook text only by re-running `rk agent setup`, so the hook-written pair needs a dual-read window.
- The managed-conf apply path (`@rk_managed`-gated sweep / WS-attach / reload-config endpoint) already visits every managed server on a cadence — the natural home for a one-shot option migration.

---

## Change 1 — run-kit · Namespace + Legacy Sweep (SMALL, ships first)

Fixes the actual bug class; independent of the wider rename.

### `internal/tmux` — option constants + migration
- Introduce `ColorOption = "@rk_win_color"`, `SessionColorOption = "@rk_ses_color"`; retire the bare `"@color"`/`"@session_color"` literals everywhere (`tmux.go:860,1127,2323,2331,2369,2378`, `layout.go:83`, `snapshot/restore.go:335`, the `POST /options` allowlist in `api/windows.go`, `api/client.ts:440,756`).
- New `MigrateLegacyOptions(ctx, server)`: a table of `{oldName, newName, scope}` rows. For each row enumerate carriers at the row's scope (`list-sessions`/`list-windows -a`/`list-panes -a` with `#{@old}`), and where old is set: `set-option <scope-flag> -t <target> @new <value>` if new is unset, then `set-option <scope-flag>u -t <target> @old`. **Also unset any legacy name found at a wrong scope** (this is what removes `fabKit`'s session-level `@color`). Idempotent; every step logged; failures non-fatal (Constitution II — cold-start equivalence).
- Hook the migration into the managed-conf apply path so it runs once per server per daemon lifetime (in-memory `migrated[server]` set, no disk state), plus behind `rk mux adopt`.
- `rk doctor` row: count of servers still carrying legacy option names.

### Frontend
- `api/client.ts` `setWindowColor` / `setSessionColor` send the new keys; nothing else user-visible.

### Docs / rules
- Registry rows in `docs/memory/run-kit/tmux-sessions.md` renamed; add a **Legacy names** column and the migration table.
- `fab/project/context.md` rule already landed (2026-08-28); link the registry from it (done).

### Tests
- Migration unit on a real test socket: legacy-at-right-scope → moved; legacy-at-wrong-scope → unset; new-already-set → old unset, new untouched; second run no-op.
- Existing color read/write tests re-pointed at new names.

### Manual verification
- `tmux -L fabKit1 list-sessions -F '#{session_name} [#{@color}] [#{@rk_ses_color}]'` shows `fabKit [] []` after the daemon's first sweep; window picker clear works.

---

## Change 2 — run-kit · Full Scope-Prefix Rename, rk-private keys (MEDIUM)

The 16 rk-private rows of the target map (everything except the four externally-written keys). Mechanical but wide.

### Backend
- Rename constants in `internal/tmux/tmux.go` (`RoleOption`, `ChatOption` stays — see Change 3, `NoteOption`, `BoardOption`, `HomeOption`, `BoardOrderOption`, `OriginOption`, `EphemeralOption` stays, `ProtectedOption` stays, `ManagedOption`, …) and every raw literal: `tmux.go`, `layout.go`, `board.go`, `snapshot/restore.go:336-341`, `api/windows.go` (`optKeyRole` + the `/options` allowlist), `api/present.go` (`presentRootOption`), `cmd/rk/role.go`, `cmd/rk/present.go`, `cmd/rk/notify.go`, `tmuxctl/client.go`.
- Delete `@rk_ctl_keepalive` + `tmuxctl.AnchorKeepaliveOption` + `setAnchorKeepalive` (no reader; registry row removed). The `_rk-ctl` anchor is identified by name already.
- Extend `MigrateLegacyOptions`' table with the 15 renamed rows (the ctl row is an unset-only row).

### Frontend
- `api/client.ts` option keys (`@rk_marker`, `@rk_flair`, `@rk_note`, `@rk_type`, `@rk_url`, `@rk_role` in the `/options` payloads) and any `data-*`/test fixtures naming them; `swatch-popover.tsx` comments.

### Docs
- Registry table rewritten in target order (grouped by scope); `architecture.md`, `agent-state.md`, `layout-snapshots.md`, `tmux-sessions.md` § boards, `ui/*.md` references; `docs/specs/agent-state.md`, `right-panel.md` (`@rk_owner` mention — check whether that key ever shipped; if not, remove), `surface-layout.md` (`@rk_type` retirement map — rename to `@rk_win_lens`).
- Toolkit-standards pass if any `rk` help text names an option.

### Tests
- All `_test.go` and `.test.ts` literals; snapshot round-trip test asserts the new names; migration test covers a full legacy server → fully renamed.

### Sequencing note
Ship 1 and 2 as **separate PRs**; 2 rebases on 1. Each PR's e2e must run against a server pre-seeded with legacy names to exercise the sweep.

---

## Change 3 — run-kit · Externally-written keys, dual-read (SMALL)

`@rk_ephemeral`, `@rk_protected`, `@rk_agent_state`, `@rk_chat`.

- Readers accept **both** names: `IsEphemeralServer`/`IsProtectedServer` check new ∥ old; `paneFormat` carries both `#{@rk_pane_agent_state}` and `#{@rk_agent_state}` (new wins when both set); same for chat. Reads stay tmux-derived; no cache.
- Writers rk owns switch to new names now: `rk mux new --ephemeral`, `MarkServerProtected`, `scripts/test-e2e.sh`, Playwright `tests/_tmux.ts`, and the **hook script text** emitted by `rk agent setup` (agent-state + chat hooks, the tmux-guard shim untouched).
- `rk agent setup` bumps its hook generation so `rk doctor` flags stale hooks still writing old names (existing shim-generation precedent in `tmux-guard-shim.md`).
- Migration table: add the four rows, but for the **pane** rows only copy-forward, never unset old while any installed hook generation < new (doctor tells you); server rows migrate normally.
- `docs/specs/agent-state.md` (cross-repo contract): document both names and the deprecation window; `agent-messaging.md`, `test-sockets.md` updated.

Do not remove old-name reads in this change. Removal is a follow-up once Change 4 has shipped and doctor reports no stale hooks on the operator's servers.

---

## Change 4 — fab-kit · `@rk_pane_agent_state` (SMALL, after run-kit Change 3 is released)

Repo: `~/code/sahil87/fab-kit`.

- `src/go/fab/internal/pane/pane.go:25` — `AgentStateOption` → `@rk_pane_agent_state`; `ReadAgentStateOption` reads new, falls back to old (`show-options -pv`, two calls or one format with both).
- `src/go/fab/cmd/fab/pane_map.go:360` `tmuxPaneFormat` — add `#{@rk_pane_agent_state}` as a new field; parser prefers it, falls back to the legacy field. Keep the field count change explicit in the comment block (lines 351/419).
- Skill/doc prose mentioning `@rk_agent_state`, `@rk_role`, `@rk_url`, `@rk_type` → new names (prose only; no code path).
- Requires an `rk` version floor note in fab-kit's docs (the version that ships run-kit Change 3).
- Tests: parser units for new-only, old-only, both-set.

---

## Follow-up (not scheduled) — run-kit · remove legacy reads

After Change 4 is released and `rk doctor` shows zero legacy names on the operator's fleet for a comfortable window: drop old-name reads and the pane-row copy-only rule; migration table becomes unset-only for all rows; delete after one more release.

Change 3 as drafted (260828-5jlp) also **dual-writes** the pane keys — `rk agent hook` sets both `@rk_pane_agent_state`/`@rk_agent_state` and `@rk_pane_chat`/`@rk_chat` — so fab-kit stays sighted between 3 and 4. The full removal ledger (constants, fallback reads, the second `set-option`, `copyOnly` rows, `rkHookMarker`, doctor gen<3 branches) lives in that change's intake § Deprecation ledger; the doctor piece is an `agent hooks` row with **no hook-text bump** (gen-3 text names no option).

---

## Execution notes for the operator

- Order: **1 → 2 → 3 → 4**; 1 and 3 could run in parallel worktrees (no file overlap beyond the migration table — rebase conflict is trivial), but 2 must follow 1.
- Each run-kit change: `/fab-new`, confidence gate, `/fab-fff`. Change types: 1 = `fix`, 2 = `refactor`, 3 = `feature` (dual-read + doctor row), 4 = `refactor`.
- Every run-kit change touches the `@rk_*` registry in `tmux-sessions.md` — hydrate must regenerate the index; reviewers should diff the registry table against the target map above.
- Immediate unblock (applied 2026-08-28): `tmux -L fabKit1 set-option -u -t 'fabKit:' @color` — session scope is the bare `-u -t <session>:`; `-s` would target the server scope and do nothing here. The migration in Change 1 must pick the flag per row's scope (`-s` server, none session, `-w` window, `-p` pane).
