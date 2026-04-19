# Intake: Fix rk iframe URL recipe — use relative /proxy/... paths

**Change**: 260419-l1ja-fix-rk-iframe-relative-urls
**Created**: 2026-04-19
**Status**: Draft

## Origin

User-initiated fix, one-shot mode (`/fab-new` with concrete change description). The user discovered this while using rk through a reverse proxy: the iframe recipe in the shared skill preamble instructs callers to compose absolute URLs via `{server_url}/proxy/<port>/<file>` where `{server_url}` is discovered by `rk context`. The problem is that `rk context` returns the server's bound URL (e.g., `http://0.0.0.0:3000`), which does not match the origin the user actually uses when accessing rk through a reverse proxy. Iframe loads fail.

The fix is purely in the *documented recipe* that skills follow when composing iframe URLs — not in `rk context` behavior, not in the backend proxy, not in the frontend `IframeWindow` component (which already correctly uses relative paths in `app/frontend/src/components/iframe-window.tsx`).

> Fix the rk iframe URL recipe so skills use relative /proxy/... paths instead of looking up the server hostname via rk context.
>
> Background: The user accesses their rk server through a reverse proxy, so rk context reports http://0.0.0.0:3000 but the user's actual access URL is different. When a skill composes an iframe URL as {server_url}/proxy/<port>/<file>, the resulting absolute URL doesn't match the user's origin and fails to load. Relative paths (/proxy/<port>/<file>) work because the rk frontend serves them through the proxy regardless of how the user reached the server.

## Why

1. **Problem**: The Visual Display Recipe in `.claude/skills/_preamble/SKILL.md` tells skills to build iframe URLs as `{server_url}/proxy/<port>/<filename>`, resolving `{server_url}` from `rk context`. `rk context` reports the server's bind address (e.g., `http://0.0.0.0:3000`). When the user accesses rk through a reverse proxy, the browser origin is different (e.g., `https://rk.example.com`). Loading `http://0.0.0.0:3000/proxy/...` inside an iframe from that origin fails — either blocked as mixed content, unreachable, or cross-origin.

2. **Consequence if unfixed**: Every skill that follows the Visual Display Recipe (currently `visual-explainer:*` and any custom skill that wants to display HTML to the user) is broken for reverse-proxied deployments. The rk iframe window renders the proxy URL, but the iframe contents fail to load. The user sees an empty window.

3. **Why relative paths**: The rk frontend serves iframe content through its own origin. The `/proxy/{port}/...` path is served by the rk backend's reverse proxy (`app/backend/api/proxy.go`) regardless of how the user reached the server. A browser-relative path `/proxy/8080/index.html` resolves against whatever origin the user is using — the reverse proxy origin, `localhost:3000`, or anything else. This is exactly how `app/frontend/src/components/iframe-window.tsx:119` already constructs iframe src when transforming `http://localhost:8080/docs` → `/proxy/8080/docs`.

4. **Why not fix `rk context`**: The server URL `rk context` returns is still useful for server-side HTTP requests (fetch from a script, `curl`, etc.) where relative paths don't apply. Changing its behavior would be invasive and is explicitly out of scope. The fix is purely in how skills compose iframe URLs.

## What Changes

### Change 1: `.claude/skills/_preamble/SKILL.md` — Visual Display Recipe

Current form (lines 228–244):

```
### Visual Display Recipe

Any skill that wants to show HTML content to the user follows this centralized 4-step recipe. Fail silently at any step if rk is unavailable or a step fails.

1. **Generate HTML** to a known location (e.g., `~/.agent/diagrams/`, a temp directory, or the project tree)
2. **Serve it** — start a local HTTP server bound to loopback (not exposed on LAN):
   ```sh
   python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &
   ```
3. **Open an iframe window** pointing to the proxy URL:
   ```sh
   tmux new-window -n <name>
   tmux set-option -w @rk_type iframe
   tmux set-option -w @rk_url {server_url}/proxy/<port>/<filename>
   ```
4. **Fail silently** — if any step fails (rk missing, port in use, server start fails), skip remaining steps without error
```

Updated form — step 3 uses a relative path for `@rk_url`, no `{server_url}` substitution:

```
3. **Open an iframe window** pointing to the proxy URL (relative path — the rk
   frontend resolves it against whatever origin the user is using, so it works
   identically whether the user is on `localhost:3000` or behind a reverse proxy):
   ```sh
   tmux new-window -n <name>
   tmux set-option -w @rk_type iframe
   tmux set-option -w @rk_url /proxy/<port>/<filename>
   ```
```

No mention of `rk context` or server-URL discovery in this step.

### Change 2: `.claude/skills/_preamble/SKILL.md` — Server URL Discovery subsection

Current form (lines 218–226):

```
### Server URL Discovery

Discover the server URL at **use-time** by running:

```sh
rk context 2>/dev/null | grep 'Server URL' | awk '{print $NF}'
```

Never hardcode the server URL — it can change between sessions.
```

Decision: **Keep the section**, but clarify it is for server-side use only — not for `@rk_url` iframe values. This preserves the information for its legitimate uses (scripts, curl, server-side fetches) while steering skills away from the wrong pattern.

Updated form:

```
### Server URL Discovery

Discover the server URL at **use-time** by running:

```sh
rk context 2>/dev/null | grep 'Server URL' | awk '{print $NF}'
```

**Use only for server-side requests** — e.g., a shell script that `curl`s the rk
API, or a background process that fetches from the proxy. The returned URL is
the server's *bind* address and may not match the origin the user is using if
rk is accessed through a reverse proxy. For iframe `@rk_url` values, use a
relative path (`/proxy/<port>/<file>`) instead — see the Visual Display Recipe.

Never hardcode the server URL — it can change between sessions.
```

### Change 3: Grep audit of other callers

Task description requires:
- `grep -rn "rk context" .claude/skills/` — find other skills that call `rk context`
- `grep -rn "@rk_url" .claude/skills/` — find other skills that set `@rk_url`

Prior scan (during intake) shows the only matches in `.claude/skills/` are in `_preamble/SKILL.md` itself (lines 197, 203, 206, 223, 241). No other skill in `.claude/skills/` composes iframe URLs via `{server_url}/proxy/...`. Plugin-provided skills (e.g., `visual-explainer:*`) live outside `.claude/skills/` and are consumers of the preamble's recipe — they don't inline the wrong pattern.

Confirmed scope: only the two subsections in `_preamble/SKILL.md` need edits.

### Change 4: run-kit source audit

Prior scan (during intake) of `app/backend/` and `app/frontend/src/`:
- `app/backend/cmd/rk/context.go` — the Proxy section at line 117–122 already uses relative `/proxy/{port}/...` form. The Iframe Windows capability section at lines 105–115 says `tmux set-option -w @rk_url <url>` — no `{server_url}` composition. Already correct.
- `app/frontend/src/components/iframe-window.tsx:119` — already uses relative path: `` return `/proxy/${port}${path}`; `` Already correct.
- No `{server_url}/proxy` or `server_url.*proxy` strings anywhere in `app/`.

No source changes required.

## Affected Memory

No memory file changes. This is a fix to a shared skill document (`.claude/skills/_preamble/SKILL.md`) that lives in the repo but is not tracked in `docs/memory/`. The fix does not alter any user-visible behavior, API surface, data model, or build configuration of run-kit itself.

## Impact

- **Affected files** (writes):
  - `.claude/skills/_preamble/SKILL.md` — two subsections updated (Server URL Discovery, Visual Display Recipe)
- **Affected files** (no writes, audited only):
  - Other `.claude/skills/**/SKILL.md` files — confirmed no other callers
  - `app/backend/cmd/rk/context.go` — confirmed already correct
  - `app/frontend/src/components/iframe-window.tsx` — confirmed already correct
- **APIs**: None
- **Dependencies**: None
- **Runtime behavior**: None — this is a documentation/recipe fix. Skills that have already been deployed still work if the operator reloads them; new skill invocations will follow the corrected recipe.
- **User-visible effect**: After this fix, any skill that uses the Visual Display Recipe to show HTML in an iframe window will work correctly whether the user reaches rk directly or through a reverse proxy.

## Open Questions

None. The change is scoped tightly, the user has specified the exact edits, and the audit has confirmed no other callers need updating.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Only `.claude/skills/_preamble/SKILL.md` needs edits — no other skills or source files compose iframe URLs with `{server_url}/proxy/...`. | Verified via grep of `.claude/skills/`, `app/backend/`, and `app/frontend/src/` during intake. Sole matches are in the preamble itself. | S:95 R:85 A:95 D:95 |
| 2 | Certain | Use a relative `/proxy/<port>/<filename>` path in the `@rk_url` example, not `{server_url}/proxy/...`. | User explicitly specified this form and gave the rationale (reverse-proxy origin mismatch). Frontend's existing `iframe-window.tsx` already uses the relative form — this is the established pattern. | S:95 R:90 A:95 D:95 |
| 3 | Confident | Keep the Server URL Discovery subsection (don't remove it) and add a clarifying note about its legitimate scope. | User offered both options ("remove entirely or repurpose"). Keeping it with a scope note preserves valid uses (server-side curl, scripts) and makes the "don't use this for @rk_url" rule discoverable. Removing it would lose the server-URL-discovery pattern entirely. Reversible — can be deleted later with a one-line edit. | S:70 R:90 A:80 D:70 |
| 4 | Certain | Do not modify `rk context` CLI behavior. | Explicit out-of-scope directive from the user. | S:100 R:80 A:95 D:100 |
| 5 | Certain | Do not touch the Proxy subsection (lines 208–216) that describes `{server_url}/proxy/{port}/...` for server-side HTTP requests. | Explicit out-of-scope directive from the user. The pattern there is correct — it's for server-side, not iframe. | S:100 R:80 A:95 D:100 |
| 6 | Certain | Change type is `fix`. | User's framing is "Fix the rk iframe URL recipe"; the work is a correction to a documented recipe that produces broken results. Keyword `Fix` dominates the description. | S:95 R:85 A:95 D:95 |
| 7 | Certain | Verification: after edits, `grep -rn "{server_url}/proxy\|server_url.*proxy" .claude/skills/` should return zero hits. | User-specified verification criterion. | S:100 R:90 A:95 D:100 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).
