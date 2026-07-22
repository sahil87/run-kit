# Intake: SSH-Host Fallback + Open-Section Editor Logos

**Change**: 260722-fc3b-ssh-host-fallback-open-logos
**Created**: 2026-07-22

## Origin

> derive deeplink ssh host from location.hostname + server user when RK_SSH_HOST unset; add editor logos to the Open section

Conversational — follow-up to `260722-6d0f-navbar-open-in-app` (merged as PR #442 / `2f389c0`). The user tested the merged feature locally, found the Open button invisible (correct degraded state at the time), then asked whether the page could use the hostname it was accessed from (typically the Tailscale MagicDNS name) as the SSH host when `RK_SSH_HOST` is unset. The assistant's three-wrinkle design (username derivation, wrong-hostname tunnel cost, alias precedence) was **agreed to in full** ("Agreed to all"). The user additionally requested editor logos in the Open section, in this same change.

Context shift since 6d0f shipped: **wt v0.1.5 now ships `wt open --list --json`** (the `[qj66]` dependency landed). Verified live output on this host — schema matches the `{id, label, kind}` contract exactly; observed registry: `code`/VSCode/editor, `cursor`/Cursor/editor, `ghostty_macos`/Ghostty/terminal, `terminal_app`/Terminal.app/terminal, `finder`/Finder/file-manager. Two facts feed this change: the VS Code **host** id is `code` (not `vscode`), and ids may be snake_case. The host section needs no run-kit code change to light up (fail-silent design working as intended).

## Why

**Problem**: the deeplink section — the entire remote story — is dark until the user hand-configures `RK_SSH_HOST`, even though in the dominant deployment (Tailscale) the browser already knows a hostname that is SSH-reachable: `location.hostname`. Zero-config users get a permanently invisible feature. Separately, the Open menu rows are text-only; app logos make the target list scannable at a glance (the Conductor reference UI the feature was modeled on shows editor icons).

**If we don't**: remote users must discover an env var before the feature exists for them; the common Tailscale case fails closed for no technical reason.

**Why this approach**: `location.hostname` is exactly the name the client reached the host by; on a tailnet it is SSH-reachable too. The one missing ingredient — the SSH username — is derivable server-side (`os/user.Current()`), which is pure derivation per constitution X (no new config). The cost is accepted explicitly: behind an HTTP-only tunnel the derived host is not SSH-reachable and the editor shows a connect error instead of the section staying hidden ("shown ⇒ works on tailnets, errors on tunnels"). `RK_SSH_HOST` remains the override for aliases, non-standard users, ports, and keys.

## What Changes

### Backend: `sshUser` on `GET /api/health`

`api/health.go` adds an `sshUser` field beside the existing `sshHost`, populated from `os/user.Current().Username` (resolved once at startup or first request; empty string on lookup failure — the frontend then omits the `user@` prefix). No new endpoint, no new config (constitution VII/X: derived, not configured).

### Frontend: deeplink host resolution + visibility gate change

In `src/lib/open-in-app.ts`:

- **Effective deeplink host** (new resolution chain):
  1. `RK_SSH_HOST` set → use it **verbatim** (no `user@` prefix — an alias carries user/port/key from the client's `~/.ssh/config`).
  2. Unset AND page is remote → derive `${sshUser}@${location.hostname}` (omit the `user@` prefix when `sshUser` is empty).
- **Visibility gate change**: the deeplink section shows whenever the client is **remote** (not-localhost), no longer gated on `RK_SSH_HOST`. Local mode is unchanged (deeplinks pointless on the host itself). The zero-targets ⇒ hidden dead-control rule is unchanged.
- `use-open-targets.ts` carries `sshUser` through `OpenContext` (same fetch-once cache, no new requests).

### Frontend: editor logos in the Open section

Menu rows (in-bar split-button menu AND overflow-chevron `Open:` rows) gain a leading icon glyph:

- **Monochrome inline SVGs** (`currentColor`, ~14–16px, no new dependency, no image fetches) — full-color brand marks would clash with the terminal aesthetic, and existing hover treatments (accent-green flips) then apply to icons for free.
- **Id-keyed icon map** in a new `src/components/open-app-icons.tsx` (or colocated module): known ids → brand glyph; unknown ids → **kind-based generic fallback** (editor → code-brackets glyph, terminal → prompt glyph `>_`, file-manager → folder glyph). Map BOTH `vscode` (deeplink id) and `code` (wt host id) to the VS Code glyph; include `cursor`, `windsurf`, plus generics for `ghostty_macos`/`terminal_app`/`finder` via their `kind`.
- Deeplink targets carry an implicit `kind: "editor"`.
- **Palette rows stay text-only** — the command palette has no icon affordance today; adding one is out of scope.

### Tests

- Health handler test: `sshUser` present/absent.
- `open-in-app.test.ts`: resolution-chain cases (alias verbatim; derived `user@host`; empty user; localhost unchanged; tunnel hostname is used as-given — no reachability guessing).
- `open-button.test.tsx`: icon rendered per row; generic fallback for unknown id.
- e2e `open-in-app.spec.ts` + **`.spec.md` sibling updated in the same commit** (constitution): the visibility-gate change alters the existing "hidden when RK_SSH_HOST unset" assertions — the remote case can't be exercised against localhost in e2e (documented limitation from 6d0f), so gate-change coverage lives in Vitest; e2e re-verifies the local behavior and icon presence in host rows.

## Affected Memory

- `run-kit/ui-patterns.md`: (modify) Open split-button — new visibility rule (remote ⇒ deeplinks shown), icon-map + generic-fallback pattern
- `run-kit/architecture.md`: (modify) `/api/health` gains `sshUser`; deeplink host-resolution chain; note wt `--list --json` shipped (v0.1.5) and the `code`-vs-`vscode` id split

## Impact

- **Backend**: `app/backend/api/health.go` (+ `health_test.go`) — one field.
- **Frontend**: `src/lib/open-in-app.ts` (+ test), `src/hooks/use-open-targets.ts` (+ test), `src/components/open-button.tsx` (+ test), new icon module, `src/api/client.ts` (HealthResponse type), e2e spec + `.spec.md`.
- **Scale**: small — no new routes, no new config, no new deps.
- **Baseline**: branch from `origin/main` (`2f389c0`) — #442 was squash-merged, so branching from the old feature branch HEAD would duplicate its commits in the next PR.

## Open Questions

- None blocking. (Explicit-disable sentinel for the fallback deliberately deferred — see Assumptions #4.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fallback chain: `RK_SSH_HOST` verbatim > derived `${sshUser}@${location.hostname}` (remote only) | Explicitly designed in discussion and user agreed to all | S:90 R:85 A:90 D:90 |
| 2 | Certain | `sshUser` derived via `os/user.Current()`, rides `GET /api/health` beside `sshHost` | Agreed; constitution X derivation; mirrors 6d0f's smallest-surface decision | S:85 R:85 A:90 D:90 |
| 3 | Certain | Deeplink section shown whenever remote; tunnel-domain connect errors accepted as the trade | The exact trade named in discussion and agreed ("shown ⇒ works on tailnets, errors on tunnels") | S:85 R:80 A:85 D:85 |
| 4 | Tentative | No explicit-disable sentinel in v1 (`RK_SSH_HOST=` empty ≡ unset — most env loaders can't distinguish; a `none` sentinel would be new vocabulary) | Discussion said "if we want one"; deferring is reversible and the gate change makes disable rarely needed | S:40 R:80 A:55 D:45 |
| 5 | Confident | Icons are monochrome `currentColor` inline SVGs, no new dependency | Terminal aesthetic + existing accent-green hover vocabulary; avoids brand-color clash and licensing-heavy asset pipelines | S:60 R:90 A:75 D:70 |
| 6 | Confident | Id-keyed icon map with kind-based generic fallback; `code` AND `vscode` → VS Code glyph | Live wt v0.1.5 registry verified (`code`, snake_case ids); fallback keeps unknown apps rendering | S:75 R:90 A:85 D:80 |
| 7 | Confident | Palette rows stay text-only | Grep confirms the palette has no icon affordance; adding one is a separate UI change | S:65 R:90 A:85 D:80 |
| 8 | Confident | Icons appear in both the split-button menu and the overflow `Open:` rows | "Open section" plainly covers both renderings of the same rows (`OpenMenuRows` shared) | S:60 R:90 A:80 D:75 |
| 9 | Confident | Remote-gate coverage in Vitest; e2e keeps local-mode + adds icon assertions | e2e cannot fake a non-local `location.hostname` against the test server (documented 6d0f limitation) | S:65 R:85 A:85 D:80 |

9 assumptions (3 certain, 5 confident, 1 tentative, 0 unresolved).
