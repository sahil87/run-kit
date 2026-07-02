# Intake: Canonical Route Page Names

**Change**: 260702-nuup-route-page-names
**Created**: 2026-07-02

## Origin

<!-- Conversationally derived — the naming vocabulary was decided live in-session. -->

The user wanted an easy, spoken-friendly vocabulary for referring to run-kit's routes. The raw TanStack path patterns (`/$server/$window` etc.) are awkward to say and blur together in conversation. We enumerated the route tree from `app/frontend/src/router.tsx`, then iterated on names.

Interaction mode: **conversational**. Decision path:

1. Listed the routes and their components (`ServerListPage`, `ServerShell`, the inherited terminal route, `BoardPage`, and the root `NotFoundPage`).
2. User proposed an aviation-themed set: `/` = Cockpit, `/$server` = "Server Cockpit", `/$server/$window` = Terminal, `/board/$name` = Board, not-found = Not Found.
3. Agent flagged that **"Cockpit" and "Server Cockpit" collide** — one word apart but conceptually the two most different pages (global home vs. a single server), so they blur in speech.
4. User asked about "Server Center" vs "Server Cabin" for `/$server`.
5. Agent recommended **"Server Cabin"**: it stays inside the aviation metaphor (a cabin is a compartment within the aircraft → natural whole→part mapping for `/` → `/$server`) and is phonetically distinct from "Cockpit". "Server Center" was rejected as off-metaphor (mixes aviation + generic dashboard-speak); "Server Cockpit" was rejected for the collision above.
6. User confirmed the final set.

This is a **documentation / naming-convention change** — it establishes a shared vocabulary and records it in two durable places. No route behavior, path, or component changes.

## Why

1. **Problem**: run-kit's routes have no human-friendly names. In conversation and in docs, people fall back to raw path patterns (`/$server/$window`) which are awkward to speak, easy to confuse (the `/$server` layout vs. its `/$server/$window` child), and don't map cleanly to a mental model. The user needs to refer to these pages "easily."

2. **Consequence if unfixed**: Ambiguous references persist. Future agents and contributors keep inventing ad-hoc names, so the same page gets called three different things across memory files, PRs, and conversation — the exact drift a naming convention exists to prevent.

3. **Why this approach**: Pick one canonical name per route, chosen for spoken clarity and a consistent aviation metaphor, and record them where they'll actually be found — the `run-kit/ui-patterns` memory file (which already documents URL structure and the route guard) and a short glossary comment in `router.tsx` next to the route tree (so the names sit adjacent to the definitions they name). No new abstraction, no code behavior change — just a vocabulary anchored in the two places that already describe the routes.

## What Changes

### The canonical name set

| Route path | Canonical name | Component | Notes |
|------------|----------------|-----------|-------|
| `/` | **Cockpit** | `ServerListPage` | Global home / server list. Also hosts the HOST HEALTH zone (the host-console "cockpit" feature, PR #290) — the "Cockpit" name has code precedent here. |
| `/$server` | **Server Cabin** | `ServerShell` | A single server's view. Layout/parent route where the `resolveServerView` guard runs. |
| `/$server/$window` | **Terminal** | *(inherited layout, no dedicated component)* | A specific terminal window (`@N`); owning session derived from the SSE snapshot, not the URL. |
| `/board/$name` | **Board** | `BoardPage` (lazy) | Board view. |
| not-found fallback | **Not Found** | `NotFoundPage` | Root `notFoundComponent` catch-all — not a registered path. |

Note the `$server`/`$window`/`$name` segments are **route params** (actual server names, window ids, board names), not literal path segments.

### 1. `docs/memory/run-kit/ui-patterns.md` (modify)

`ui-patterns` already documents the URL structure and the three-way server route guard. Add the canonical page-name vocabulary — a short table or inline glossary mapping each route path to its name — so the memory that describes the routes also names them. Keep it colocated with the existing "URL structure" content, not as a separate top-level section if one already fits.

### 2. `app/frontend/src/router.tsx` (modify — comment only)

Add a brief glossary comment block next to the `routeTree` definition (around the `rootRoute.addChildren([...])` call, ~line 65) listing each route → canonical name. This puts the names adjacent to the definitions. **Comment only — no code, no route, no component-name changes.**

### 3. `fab/project/constitution.md` — Principle IV (modify)

Correct the stale route description in **Principle IV (Minimal Surface Area)**, line 15. The current text is doubly inaccurate against the live route tree:

```
The UI MUST stay minimal — two routes (`/` redirect, `/$session/$window`), ...
```

- **"two routes"** is wrong — the tree now has 5 (`/`, `/$server`, `/$server/$window`, `/board/$name`, plus the not-found fallback).
- **`/$session/$window`** is wrong — the terminal route is `/$server/$window`; the old 3-segment `/$server/$session/$window` form was a hard break with no redirect shim (see the `router.tsx` comment). The `/` route is no longer a "redirect" either — it renders the Cockpit (`ServerListPage`).

Update the parenthetical to reflect the real tree, using the new canonical names for readability, e.g.:

```
The UI MUST stay minimal — a small fixed route set (Cockpit `/`, Server Cabin `/$server`, Terminal `/$server/$window`, Board `/board/$name`), no settings pages, no admin panels.
```

Keep the rest of Principle IV (the "New pages SHOULD only be added…" guidance and "Resist feature creep") unchanged. The principle's *intent* — minimal surface area — is unchanged; only the illustrative route list is being corrected to match reality and adopt the canonical names. **This is a factual correction, not a governance/policy change**, so no version bump semantics beyond the constitution's own `Last Amended` line (bump it to today and note the correction if the constitution's governance convention calls for it — see assumption #5).

### Expected outcome

- One canonical spoken name per route, recorded in `ui-patterns` memory and as a `router.tsx` glossary comment.
- Conversation, PRs, and docs can say "the Server Cabin" / "the Cockpit" / "the Terminal" unambiguously.
- Constitution Principle IV's route list is corrected (no longer "two routes" / `/$session/$window`) and adopts the canonical names.
- Zero runtime/behavior change; the aviation metaphor (Cockpit → Server Cabin → Terminal) is intentionally consistent and collision-free.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — add the canonical route→name vocabulary (Cockpit / Server Cabin / Terminal / Board / Not Found) alongside the existing URL-structure and route-guard documentation. This is a genuine spec-level documentation addition (a naming convention), so it belongs in memory, not just a code comment.

## Impact

**Frontend:**
- `app/frontend/src/router.tsx` — add a glossary comment next to the route tree. No code change.

**Docs/Memory:**
- `docs/memory/run-kit/ui-patterns.md` — add the name vocabulary (this is the substantive deliverable).

**Governance:**
- `fab/project/constitution.md` — correct Principle IV's stale route list ("two routes (`/` redirect, `/$session/$window`)") to match the live 5-route tree and adopt the canonical names.

**Backend:** none.

**Tests:** none — no behavior changes, nothing to assert. (A comment, a memory doc addition, and a constitution text correction have no test surface.)

**Constitution touchpoints:** IV (Minimal Surface Area) — this change *edits* Principle IV to correct its stale route list, and is itself *positively* served by IV (it adds no route/page/component; it only names what exists). The edit is a factual correction to the illustrative route parenthetical, not a change to the principle's minimal-surface intent.

## Open Questions

- None blocking. Two minor judgment calls (see Assumptions): the exact placement/format of the memory entry, and whether correcting Principle IV requires bumping the constitution's `Last Amended` date / version per its own governance convention.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The canonical set is: `/` = Cockpit, `/$server` = Server Cabin, `/$server/$window` = Terminal, `/board/$name` = Board, not-found = Not Found | Decided and confirmed by the user live in-session; "Server Cabin" chosen over "Server Cockpit" (collision) and "Server Center" (off-metaphor) with the user's explicit agreement | S:95 R:80 A:95 D:95 |
| 2 | Certain | Record the names in two places: `run-kit/ui-patterns` memory (the deliverable) and a `router.tsx` glossary comment (colocation) | User asked for names to "refer to pages easily"; the agent offered memory + comment and the user chose "add as an intake" scoping both durable locations. `ui-patterns` already owns URL-structure docs | S:90 R:85 A:90 D:85 |
| 3 | Certain | No code/route/component-name changes — comment + memory only; zero behavior change, no tests | The routes and components are unchanged; renaming components (e.g. `ServerShell` → `ServerCabin`) was never requested and would be a much larger, riskier change | S:90 R:75 A:95 D:90 |
| 4 | Confident | Place the memory entry as a compact table/glossary within `ui-patterns`'s existing URL-structure content rather than a new top-level section | Keeps related docs together and avoids restructuring; exact heading placement is a hydrate-time detail and is reversible | S:70 R:85 A:80 D:70 |
| 5 | Certain | Correct the stale route list in `constitution.md` Principle IV ("two routes (`/` redirect, `/$session/$window`)") to the live 5-route tree, adopting the canonical names | User explicitly asked to "add a note to correctly update the constitution also in this change"; the line is factually wrong (wrong count AND wrong param — `/$session/$window` never existed as the terminal route), so correcting it alongside the naming work is a clean fit | S:90 R:80 A:90 D:85 |
| 6 | Confident | Treat the Principle IV edit as a factual correction to an illustrative list, not a policy change — bump the constitution's `Last Amended` date to today (and note the correction) but do NOT change the principle's normative intent or force a major version bump | The minimal-surface *rule* is unchanged; only the example route list is corrected. The exact version-bump semantics defer to the constitution's own governance convention (`Version` / `Ratified` / `Last Amended` block), resolvable at apply time | S:70 R:80 A:75 D:70 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
