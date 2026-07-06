# row-minimalism.spec.ts

Verifies **Row Minimalism** (260706-y1ar; `docs/specs/status-pyramid.md`
§ Row Minimalism): the sidebar window ROW renders no fab stage word and no
duration text — the leading `StatusDot` is the row's only externally visible
status signal; the exact stage + durations live in the StatusDotTip and the
PANE panel register view.

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads (the isolated
  e2e tmux server has neither, and `gh` is unavailable in CI). The spec injects
  the data via `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (window selection POST).
  - `**/api/sessions/stream*` → one `event: sessions` frame with a session
    `dev` and two windows:
    - `@1` "feature-work" — a fab window at `review` (`fabStage: review`,
      `fabDisplayState: active`). Under the OLD model this row printed a
      "review" stage word.
    - `@2` "scratch-shell" — an idle agent window (`agentState: idle`,
      `agentIdleDuration: 2m`). Under the OLD model this row printed "2m".
  - The relay WebSocket is stubbed so the terminal route mounts without churn.
- `beforeEach` installs the routes before navigation.

## Tests

### `window rows show no stage word and no duration text (only the dot + name)`

**What it proves:** the trailing status cluster (stage word + duration) was
removed from the window row — neither the "review" stage word nor the "2m"
duration appears anywhere in the sidebar navigation tree — while the window
names and the leading StatusDot remain.

**Steps:**
1. Navigate to `/default/1`.
2. Assert both window names ("feature-work", "scratch-shell") are visible (the
   rows render).
3. Scope to the sidebar tree (`role="tree"`) and assert it contains no exact
   "review" text (count 0) and no exact "2m" text (count 0).
4. Assert the leading StatusDot is present as the status signal: the fab review
   window shows the green `role="img"` dot with aria-label `review — active`.
