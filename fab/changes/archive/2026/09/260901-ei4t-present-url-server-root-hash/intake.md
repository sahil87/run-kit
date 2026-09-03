# Intake: Present URLs Re-Keyed on (Server, Root Hash)

**Change**: 260901-ei4t-present-url-server-root-hash
**Created**: 2026-09-01

## Origin

Synthesized description from a `/fab-discuss` design session (2026-09-01), dispatched promptless via `/fab-proceed` (no questions asked; open decisions deferred as Unresolved rows). Conceptual framing agreed in the session: "when you run `rk present` you are asking run-kit to present, not the tab — the tab (and its web-tab slot) is merely the final presenter."

> Re-key `/present` URLs on (tmux server, root hash) — from slot-keyed to content-keyed addressing. New route form `/present/{server}/{roothash}/{path}`; resolution is derivation-only per request; no maintained list of presented paths; security posture unchanged; presentation-lived server-wide lifetime; legacy slot form kept one release; stored `@rk_win_web_<n>` value adopts the hash form; the backend add verb composes the new form.

## Why

**Problem.** Today's present URL is `/present/{windowId}/{n}/{path}?server={srv}` — its identity is `(window, slot)`. The slot is strip plumbing, not content identity:

1. **`rm` renumbering silently re-points or 404s copied links.** Verified in `app/backend/internal/tmux/webtabs.go`: `WebRemove`/`shiftWebTabs` move the stored URL and root down a slot *verbatim* — the URL string still embeds its original slot index, so after removing a lower slot, a shifted `/present/` tab's URL reads `@rk_win_web_<embedded-n>_root`, which now belongs to the *next* tab (wrong content) or is unset (404). There is no rewrite arm today.
2. **Wrong content served silently.** A same-named file under whatever root later occupies the slot serves wrong content with no error.
3. **Window kill takes links with it**, even when another window on the server still presents the same root.

**Consequence of not fixing.** Copied/stored present links are unstable under ordinary strip operations (`rm`, re-present, window kill); the stored-value renumber bug class above is live today.

**Why this approach.** The job of `rk present` is to present an artifact; the artifact's identity is the presented root directory + relative path. Keying the URL on `(tmux server, sha256-prefix of the absolute root, relative path)` makes the URL content-addressed: it survives slot renumber, swap, re-present, and window kill (as long as any window on the server still presents the root), and dies with the last presenter — revocation-on-last-rm is a feature (web-tab strips remain the visible consent surface). Resolution stays pure derivation (Constitution II/X): zero new state.

**Alternatives rejected in the session** (recorded for traceability):

- **Stable per-tab ids** — breaks the dense 1-based indexed family and the tick's fixed-format enumeration; spec already decided dense-renumber + identity-is-URL.
- **Path in the URL** — leaks filesystem layout, no gain over the hash.
- **Content hash** — changes every edit, breaks re-present-is-refresh.
- **Window-scoped hash** (`/present/@N/r/{hash}/…`, the first draft) — fixed renumbering but still died with the window and kept the presenter in content identity.
- **Maintained server-scoped array of presented paths** — a second source of truth for a derivable fact (Constitution X: derivation wins) with a GC hole: windows die outside rk's sight (raw `kill-window`, pane exit), so stale entries would stay servable for the server's lifetime.
- **Named presents (`rk present --as`)** — a name registry; collides with the "indexed, not named" decision.

## What Changes

### 1. New route form: `/present/{server}/{roothash}/{path}`

- The tmux **server name is promoted from `?server=` into the path** — it is identity, not plumbing (`@N` window ids are unique only per server today; roots are declared per server here).
- `{roothash}` = a **prefix of sha256 of the ABSOLUTE presented root directory** (e.g. sha256 of `/home/sahil/reports`). Example URL: `/present/runKit/3f9a2c8e/report.html`.
- `{path}` is relative to that root; a directory target has an empty `{path}` and serves the root's `index.html` (trailing-slash redirect behavior unchanged from today's handler).
- The hash is an **identifier, not a secret** — unsalted, computable by anyone who knows the path; origin-level access (loopback / SSH tunnel) remains the boundary. Improvement over path-in-URL: one-way, never leaks filesystem layout.
- The `{server}` path segment is gated by the existing `validate.ValidateServerName` shape (`^[a-zA-Z0-9_-]+$`, `internal/validate/validate.go:328`) before any subprocess (Constitution I); `serverFromRequest` becomes path-derived for the new form.

### 2. Resolution: derivation-only, per request (Constitution II/X)

- One `list-windows -a -F` call with the 8 root slots spelled out (`#{@rk_win_web_1_root}` … `#{@rk_win_web_8_root}` — the same fixed-format trick `webFamilyFormat` in `internal/tmux/webtabs.go` and the ListWindows tick use) yields every root any window on the server currently declares.
- sha256 each declared root; match the URL's hash segment against the same-length prefix; serve with the **EXISTING symlink-resolved containment logic unchanged** (`resolvePresentFile` → `EvalSymlinks` on both root and candidate + `filepath.Rel` containment in `api/present.go`); no match → 404.
- **Zero new state** — no registry, no cache, no disk store. The declaration check is the anti-scanning property: an undeclared root → 404, so `/present` can never walk the filesystem.

### 3. Lifetime: presentation-lived, server-wide

Survives slot renumber, swap, re-present, and window kill as long as ANY window on the server still declares the root; dies with the last presenter. No GC needed — resolution re-derives the declared set on every request.

### 4. Legacy compat (one release)

The slot form `/present/@N/{n}/{path}?server=` stays registered for one release, sniffed by the first segment's `^@` shape — the exact mechanism the existing n-less compat forms use in `api/present.go` (one handler, segment sniff; chi route ordering between the forms is ambiguous, so the sniff disambiguates). Old stored URLs keep serving until re-presented. The existing slot-1 dual-read of the retired `@rk_win_present_root` rides along on the legacy arm unchanged.

### 5. Stored form: `@rk_win_web_<n>` adopts the hash form

The hash form becomes the STORED slot value too (session leaned strongly yes; repo evidence closes it — see Assumptions #9/#10): stored form, iframe src, and copyable form become the same string modulo origin and `?v=`. This **dissolves the renumber-rewrite seam**: today the stored value embeds its own slot, and `WebRemove` ships the leave-stale arm (verified — mis-serve/404 after a lower-slot remove). With the hash form the stored URL carries no slot, so density shifts move it losslessly.

- `?v=` cache-buster still rides the stored value (the re-present-is-refresh contract): `present.BumpVersion` continues to apply.
- `webTabURLIdentical` / `presentTargetIdentity` (in `webtabs.go`) update to the new shape: target identity becomes (server, roothash, path) minus `?v=` — the stored-root comparison in `WebAdd` remains the tie-breaker where roots differ.

### 6. Composition: the add verb hashes once at add time

`present.PresentURL` / `Target.URL` (`internal/present/present.go`) compose the new form for file/dir kinds: the backend add verb (`rk present` via `cmd/rk/present.go`, and `POST /api/windows/{windowId}/web` via `api/windows_web.go`) hashes the absolute root once at add time. The slot index parameter drops out of the URL composition (the root option still lands in the slot's `@rk_win_web_<n>_root`).

### 7. Frontend recognition

`app/frontend/src/lib/web-url.ts` — `classifyAddress` / `displayForm` / `webTabTitle` / `toWebAddTarget` recognize the new present shape. Display form at rest is unchanged: the file's basename with plumbing hidden (the `server` segment, hash segment, and `v` param are all plumbing to the display layer).

## Affected Memory

- `run-kit/api-and-sockets`: (modify) `/present` route row — re-keyed to `(server, roothash)`, path-derived server, legacy slot-form compat window, derivation-only resolution over the declared root set
- `run-kit/ui/lenses-and-layout`: (modify) § Address model — present-kind recognition of the new shape; display form unchanged at rest
- `run-kit/tmux-sessions`: (modify) `@rk_win_web_<n>` registry row — stored value form for present targets becomes the server/roothash form

Spec impact (human-curated, noted for the plan): `docs/specs/ui-state.md` § Web Tabs — the `/present/{windowId}/{n}/*` handler description and the `@rk_win_web_<n>` value form.

## Impact

- `app/backend/api/present.go` — handler: new-form parsing (server + hash segments), per-request root-set derivation + hash match, legacy `^@` sniff arm; containment logic untouched
- `app/backend/api/router.go` — route registration for the new shape beside the compat forms (`/present/{server}/{roothash}/*` etc.)
- `app/backend/internal/present/present.go` — `PresentURL`/`Target.URL` compose the new form; root hashing helper; `BumpVersion` shape check
- `app/backend/internal/tmux/webtabs.go` — `presentTargetIdentity`/`webTabURLIdentical` re-shaped; possibly a server-wide root enumeration helper
- `app/backend/api/windows_web.go` + `cmd/rk/present.go` — composition call sites (slot index no longer feeds the URL)
- `app/frontend/src/lib/web-url.ts` (+ `web-url.test.ts`) — new present shape in classify/display/title/add-target
- e2e: `web-tabs.spec.ts`, `web-view-lens.spec.ts`, `present-auto-expand.spec.ts`, `web-tile-chrome.spec.ts` and the `_web-tile.ts`/`_tmux.ts` helpers that stamp `@rk_win_web_<n>` present values
- Go tests: `api/present_test.go` (containment/sniff tables), `internal/present`, `internal/tmux` webtabs tests

## Out of Scope (explicit follow-ups — do NOT fold in)

- `Web: Copy link` palette affordance + a `shareForm(url, origin)` helper in `web-url.ts`
- `?web=<n>` one-shot intent param on the terminal route

## Open Questions

- Hash length: 8 hex chars used in session examples; 8–16 plausible. Collision domain is tiny (roots declared per server). Deferred — promptless dispatch.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New route form `/present/{server}/{roothash}/{path}` — server promoted from `?server=` into the path (identity, not plumbing) | Discussed — decided in the design session with the example `/present/runKit/3f9a2c8e/report.html` | S:95 R:70 A:90 D:95 |
| 2 | Certain | `{roothash}` = prefix of sha256 of the ABSOLUTE presented root directory; unsalted identifier, not a secret | Discussed — decided; security posture explicitly settled (origin-level access remains the boundary) | S:95 R:75 A:90 D:90 |
| 3 | Certain | Resolution is derivation-only per request: one `list-windows -a -F` over the 8 spelled-out root slots, sha256 each, match, serve via the existing symlink-resolved containment; no match → 404; zero new state | Discussed — decided (Constitution II/X); `webFamilyFormat` in webtabs.go proves the fixed-format trick | S:95 R:70 A:95 D:95 |
| 4 | Certain | No maintained list of presented paths | Discussed — explicitly rejected: second source of truth for a derivable fact + GC hole (windows die outside rk's sight) | S:90 R:80 A:95 D:90 |
| 5 | Certain | Security posture unchanged: declaration check is the anti-scanning property; containment logic (`EvalSymlinks` + `Rel`) untouched | Discussed — decided; existing `resolvePresentFile` reused verbatim | S:90 R:75 A:90 D:90 |
| 6 | Certain | Lifetime: presentation-lived, server-wide; dies with the last presenter; revocation-on-last-rm is a feature | Discussed — decided; strips remain the visible consent surface | S:90 R:70 A:85 D:90 |
| 7 | Certain | Legacy compat: slot form `/present/@N/{n}/{path}?server=` registered one release, sniffed by the first segment's `^@` shape | Discussed — decided; the exact mechanism of the existing n-less compat sniff in api/present.go | S:90 R:85 A:95 D:90 |
| 8 | Certain | The backend add verb composes the new form and hashes the root once at add time | Discussed — decided; composition sites verified (present.go `PresentURL`, windows_web.go, cmd/rk/present.go) | S:90 R:80 A:90 D:90 |
| 9 | Certain | Today's renumber does NOT rewrite the embedded slot: `WebRemove`/`shiftWebTabs` move stored URLs verbatim, so a shifted present tab's URL reads the wrong slot's root (mis-serve or 404) | Verified in repo — `internal/tmux/webtabs.go` (the open decision the session asked to verify) | S:85 R:90 A:100 D:95 |
| 10 | Confident | The stored-form switch (point 5 above) ships IN this change, not as a follow-up | Session leaned strongly yes; repo evidence (#9) shows the leave-stale arm ships today — a live bug class the hash form dissolves | S:70 R:55 A:80 D:75 |
| 11 | Certain | `?v=` cache-buster keeps riding the stored value (re-present-is-refresh); `BumpVersion` and target-identity helpers update to the new shape | Discussed — decided ("?v= still rides the stored value") | S:85 R:75 A:85 D:85 |
| 12 | Certain | `{server}` path segment gated by existing `validate.ValidateServerName` before any subprocess; `serverFromRequest` path-derived for the new form | Constitution I + existing validator (`^[a-zA-Z0-9_-]+$`); the description names serverFromRequest's change | S:75 R:80 A:90 D:85 |
| 13 | Confident | Ambiguous hash match (two declared roots sharing the URL's prefix) fails closed → 404 | Not discussed; fail-closed is the security-consistent default and the collision domain is tiny; trivially revisited <!-- assumed: ambiguous-prefix collision fails closed — consistent with the 404-everything error posture of the handler --> | S:30 R:75 A:70 D:45 |
| 14 | Unresolved | Hash length: 8 hex (session examples) vs longer (8–16 plausible) | Deferred — promptless dispatch | S:45 R:55 A:50 D:35 |
| 15 | Certain | Frontend `web-url.ts` recognizes the new present shape; display form at rest unchanged (basename, plumbing hidden) | Discussed — listed in affected surfaces with the display contract stated | S:85 R:85 A:90 D:90 |

15 assumptions (12 certain, 2 confident, 0 tentative, 1 unresolved).
