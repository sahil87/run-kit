# Intake: Open-Apps GUI Locus Filter

**Change**: 260902-k2pm-open-apps-gui-locus-filter
**Created**: 2026-09-03

## Origin

Backlog item `[k2pm]` (2026-09-02), created via `/fab-new k2pm` (interactive):

> wt open --list --json is becoming the complete locus-aware registry (wt change 260902-ps3l-open-list-locus-registry, fixes wt backlog [i2ap]): every record gains locus (gui/session/caller/host) alongside kind (enum extended: multiplexer/shell/clipboard), action rows (open_here, tmux_window, tmux_session, byobu_tab, copy_*) are now emitted, and the DetectDefaultApp row carries optional default:true. run-kit must update GET /api/open-apps to filter records to locus=="gui" (compatible with both old and new wt output — deploy this filter BEFORE upgrading wt); optionally use the default marker to preselect in the open-on-host dropdown.

Conversation context: the user confirmed **wt has already been updated on this system** — the "deploy the filter BEFORE upgrading wt" ordering is already violated locally, so this is a live bug, not a pre-emptive guard. Probed on this host (2026-09-03), `wt open --list --json` emits:

```json
[
  {"id": "open_here",    "label": "Open here",    "kind": "shell",       "locus": "caller"},
  {"id": "tmux_window",  "label": "tmux window",  "kind": "multiplexer", "locus": "session", "default": true},
  {"id": "tmux_session", "label": "tmux session", "kind": "multiplexer", "locus": "session"}
]
```

Zero `locus:"gui"` rows on this headless Linux box — after filtering, the registry is correctly empty here (the "on host" section hides). On a GUI host (macOS), gui rows (`code`, `cursor`, `finder`, …) appear and one may carry `default:true`. Note `default:true` can ride a non-gui row (as above) — the preselect logic must only consider it on rows that survive the filter.

## Why

1. **Problem**: run-kit's `GET /api/open-apps` (`app/backend/api/open.go` `handleOpenApps`) returns the `wt open --list --json` registry verbatim (the `internal/wt` `parseApps` tolerant parser ignores unknown fields, so the new `locus` field passes through invisibly and every row is kept). The new wt emits non-GUI action rows (`open_here`, `tmux_window`, `tmux_session`, `byobu_tab`, `copy_*`) — these now appear in the top-bar Open control's "on host" section as if they were host GUI apps.
2. **Consequence if unfixed**: on this system the dropdown currently offers "Open here / tmux window / tmux session" as host apps. Selecting one POSTs `/api/open`, which validates the id against the same unfiltered registry (`appInRegistry`) and execs `wt open <path> -a tmux_window` — a session-locus action run from the daemon's context, not a host GUI launch. Junk rows at best; confusing side effects at worst.
3. **Approach**: filter to `locus == "gui"` at the `internal/wt` wrapper's parse seam, treating a **missing** `locus` field as gui (old-wt output was all GUI apps — this is the required both-directions compatibility). Filtering at the wrapper means both consumers of `ListApps` — the GET registry and the POST launch validation — see the same gui-only view, so non-gui ids also 400 at launch. Pass the `default` marker through to the frontend and use it to order the host section (the backlog's optional preselect — cheap to include since wt already emits it).

## What Changes

### Backend — `app/backend/internal/wt/wt.go`

- `App` struct gains two fields:
  ```go
  type App struct {
      ID      string `json:"id"`
      Label   string `json:"label"`
      Kind    string `json:"kind,omitempty"`
      Locus   string `json:"locus,omitempty"`
      Default bool   `json:"default,omitempty"`
  }
  ```
- `parseApps` gains the locus filter alongside its existing id/label requirement: keep a row iff `a.Locus == "" || a.Locus == "gui"`. Empty locus = old-wt back-compat (pre-locus registries were all GUI apps). Rows with any other locus (`session`, `caller`, `host`, or future values) are skipped, not fatal — same tolerant posture as the existing missing-id/label skip.
- Doc comments updated: the package header's registry description and `parseApps`'s contract note the gui-locus filter and the empty-locus back-compat rule.
- No change to `ListApps`/`Open` exec plumbing, timeouts, or the API layer's fail-silent degradation — `handleOpenApps` and `handleOpen` (`app/backend/api/open.go`) are consumers of the already-filtered `ListApps` and need no code change (behavioral change rides the wrapper: `appInRegistry` now rejects non-gui ids at POST `/api/open`).

### Frontend — `app/frontend/src/api/client.ts` + `app/frontend/src/lib/open-in-app.ts`

- `OpenApp` type gains `default?: boolean` (passthrough of the wt marker; the backend's `omitempty` means it is absent unless true).
- `buildOpenTargets` (`open-in-app.ts`) orders the host section with the default-marked app first: a stable partition (default-marked rows before the rest, otherwise preserving registry order). This is the "preselect in the open-on-host dropdown" — the default app tops the host section in both the Open menu and the palette (both consume the same target order). No primary-segment or last-used behavior change: last-used continues to own the primary action.
<!-- assumed: "preselect" = default-marked app sorts first in the host section; not a primary-segment fallback or auto-highlight — matches the backlog's literal "preselect in the dropdown" with the least behavior change -->

### Tests

- `app/backend/internal/wt/wt_test.go` (`parseApps` cases): new-shape rows filtered to gui only; empty/missing locus kept (old-shape back-compat); the probed real payload above yields `[]`; `default` field decoded and passed through on a gui row; non-gui `default:true` row dropped.
- No API-layer test: `mockWtOps` stubs `ListApps` itself (above `parseApps`), so an `open_test.go` case cannot exercise the filter — wrapper unit tests are the sole meaningful seam; `handleOpen` gets the filtered view in production because the real `ListApps` parses through it (see plan.md Assumption 1).
- `app/frontend/src/lib/open-in-app.test.ts` (or the existing suite covering `buildOpenTargets`): default-marked host app ordered first; order stable when no row is marked.
- E2e `open-in-app.spec.ts` stubs `**/api/open-apps*` via `page.route` and so bypasses the backend filter — no e2e change required for the filter itself; the stub registry may gain a `default:true` row to cover ordering end-to-end if cheap.

## Affected Memory

- `run-kit/architecture.md`: (modify) `internal/wt` wrapper entry — App struct fields (`locus`, `default`), parseApps gui-locus filter + empty-locus back-compat, the locus-aware wt registry (wt 260902-ps3l)
- `run-kit/api-and-sockets.md`: (modify) `/api/open-apps` row (gui-filtered registry), `/api/open` row (non-gui ids rejected), `getOpenApps()` client row (`OpenApp` gains `default?`)
- `run-kit/ui/top-bar.md`: (modify) Open split-button host section — default-marked app ordered first; test inventory additions

## Impact

- **Code**: `app/backend/internal/wt/wt.go` + `wt_test.go`, `app/backend/api/open_test.go` (tests only), `app/frontend/src/api/client.ts` (type only), `app/frontend/src/lib/open-in-app.ts` + its test. `handleOpenApps`/`handleOpen` behavior changes without code changes (filtered upstream).
- **API surface**: `GET /api/open-apps` response shape gains optional `default` field; rows are now gui-only. No route or verb changes (Constitution IV/IX untouched).
- **Deploy ordering**: moot on this host (wt already upgraded); for other hosts the filter is back-compatible with old wt output, so run-kit can deploy in any order from here on.
- **Cross-repo**: consumes wt change `260902-ps3l-open-list-locus-registry`; no wt-side work in this change.

## Open Questions

- None — the backlog entry is prescriptive and the new output shape was probed live on this host.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Filter to `locus == "gui"`, treating a missing `locus` as gui (old-wt rows kept) | Backlog explicitly requires the filter and both-directions compatibility; old registries were all GUI apps | S:90 R:85 A:95 D:90 |
| 2 | Confident | Filter lives in `parseApps` (the `internal/wt` wrapper seam), not in `handleOpenApps` | The wrapper is the existing tolerant-parse seam; filtering there gives both `GET /api/open-apps` and `POST /api/open` validation the same gui-only view, so non-gui ids also 400 at launch | S:70 R:80 A:80 D:70 |
| 3 | Confident | Include the optional `default` passthrough (App.Default → `OpenApp.default?`) in this change | Backlog suggests it, wt already emits it on this system, and the passthrough is two struct fields — deferring saves nothing | S:60 R:85 A:75 D:65 |
| 4 | Confident | "Preselect" = stable sort of the default-marked app to the front of the host section in `buildOpenTargets`; no primary-segment/last-used change | Literal read of "preselect in the open-on-host dropdown"; least-behavior-change option; last-used already owns the primary action (top-bar.md § Open split-button) | S:50 R:80 A:60 D:45 |
| 5 | Certain | No handling needed for the extended `kind` enum (`multiplexer`/`shell`/`clipboard`) | `kind` is advisory-passthrough by design (wrapper doc); the new kinds ride non-gui rows that the filter drops; frontend icon mapping has a generic fallback | S:85 R:90 A:95 D:90 |
| 6 | Certain | Filter coverage is Go unit tests; e2e unaffected | `open-in-app.spec.ts` stubs the API via `page.route`, bypassing the backend filter — Go tests are the only seam that exercises `parseApps` | S:80 R:90 A:90 D:85 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
