# Spec: Right-align Server Name in Server Panel Header

**Change**: 260418-2cjc-right-align-server-name
**Created**: 2026-04-18
**Affected memory**: None — sidebar panel header chrome is implementation-level and not currently described at the title/headerRight granularity in `docs/memory/run-kit/ui-patterns.md`.

## Sidebar: Server Panel Header

### Requirement: Fixed Panel Title
The Server panel's `CollapsiblePanel` title SHALL be a static string — it MUST NOT embed the active server name. The title SHALL be `"Server"`, matching the singular-noun convention already established by the neighboring `"Pane"` and `"Host"` panel titles (`status-panel.tsx:80`, `host-panel.tsx:45`).

#### Scenario: Title is static
- **GIVEN** the sidebar renders with an active server named `default`
- **WHEN** the user reads the Server panel's header
- **THEN** the header title text is exactly `Server`
- **AND** the title text MUST NOT contain the substring `default` (or any other active server name)
- **AND** the title text MUST NOT contain `Tmux · ` or the U+00B7 middle-dot glyph

#### Scenario: Title stable across server switches
- **GIVEN** the Server panel is rendered with active server `default`
- **WHEN** the active server changes to `work`
- **THEN** the header title remains `Server`
- **AND** the visual position of the title text does not shift

### Requirement: Server Name Rendered in Right Slot
The active server name SHALL be rendered via the `CollapsiblePanel` `headerRight` prop, so that it is right-aligned by the panel's shared `ml-auto flex items-center gap-1 min-w-0 truncate` wrapper (`collapsible-panel.tsx:281-285`). This MUST match the placement convention used by `HostPanel` for the hostname (`host-panel.tsx:32-42`) and by `WindowPanel` for the active window name (`status-panel.tsx:73-77`).

#### Scenario: Server name is right-aligned
- **GIVEN** the Server panel is rendered with active server `work`
- **WHEN** the user inspects the header layout
- **THEN** the server name `work` is visible within the `headerRight` slot (sibling under the `ml-auto`-positioned span)
- **AND** the server name is right-aligned in the header, flush with the right edge of the header content area
- **AND** the chevron and static title (`Server`) remain at the left

#### Scenario: Long server name truncates rather than pushing layout
- **GIVEN** the Server panel is rendered with active server name exceeding available header width (e.g., `very-long-server-identifier-name`)
- **WHEN** the header lays out
- **THEN** the server name span is constrained by the `truncate` class on its container and MUST ellipsize
- **AND** the title `Server` and chevron MUST NOT be pushed off-screen or wrap to a new line

### Requirement: Server Name Styling Mirrors Host
The server name span SHALL use styling `text-text-primary font-mono` with `truncate`, mirroring `HostPanel`'s hostname span (`host-panel.tsx:34`). Server identifiers are machine-level identifiers on par with hostnames, warranting the primary-text treatment — not the secondary treatment used for the `WindowPanel` window name (window names are narrower in scope).

#### Scenario: Server name uses primary text color
- **GIVEN** the Server panel is rendered with active server `default`
- **WHEN** the DOM node for the server name is inspected
- **THEN** the element SHALL carry the `text-text-primary` and `font-mono` CSS classes
- **AND** the element SHALL carry the `truncate` CSS class

### Requirement: Refresh Spinner Coexists with Server Name
When `refreshing` is true (panel toggled open, async `onRefreshServers` in flight), the existing `LogoSpinner` indicator SHALL render as a sibling node within the same `headerRight` slot, positioned after the server name. When `refreshing` is false, only the server name SHALL appear in `headerRight`. No other refresh-indication behavior changes (spinner size, visibility trigger, cleanup).

#### Scenario: Server name always present, spinner conditional
- **GIVEN** the Server panel is open and no refresh is in flight
- **WHEN** the header is inspected
- **THEN** the `headerRight` slot contains exactly one visible element: the server-name span
- **AND** no `LogoSpinner` is rendered

#### Scenario: Server name remains visible during refresh
- **GIVEN** the Server panel is open and `onRefreshServers` returns a pending promise
- **WHEN** `refreshing` transitions from `false` to `true`
- **THEN** the server-name span remains in place in the `headerRight` slot
- **AND** a `LogoSpinner` node is rendered as its sibling, to the right of the name
- **AND** after the promise resolves, the `LogoSpinner` is removed and the server name remains

### Requirement: No Other Header Behavior Changes
This change SHALL NOT modify any other aspect of the `ServerPanel` header or body: the `headerAction` `+` button (`New tmux server`), `storageKey`, `defaultOpen`, `onToggle`, `contentClassName`, `tint`, `tintOnlyWhenCollapsed`, `resizable`, `defaultHeight`, `minHeight`, `mobileHeight`, and all tile-grid behaviors MUST remain untouched. The change is scoped to the two props `title` and `headerRight`.

#### Scenario: Headers `+` action preserved
- **GIVEN** the Server panel is rendered
- **WHEN** the user clicks the `+` button in the header
- **THEN** `onCreateServer` is invoked
- **AND** the panel does not toggle open/closed as a side effect
- **AND** the button's accessible name remains `New tmux server`

#### Scenario: Refresh-on-open behavior preserved
- **GIVEN** the Server panel is closed
- **WHEN** the user clicks the header to open it
- **THEN** `onRefreshServers` is invoked exactly once
- **AND** the `LogoSpinner` appears during the pending refresh

## Sidebar: Test Suite Updates

### Requirement: Test Helper Matches New Title
The `openPanel` helper in `server-panel.test.tsx` currently matches the header toggle button by accessible name `/Tmux/`. The helper SHALL be updated to match against the new static title `/Server/` so existing interaction tests continue to function against the new header.

#### Scenario: Open helper locates header button by `Server` label
- **GIVEN** the updated `ServerPanel` component
- **WHEN** the `openPanel()` test helper runs
- **THEN** it SHALL locate the header toggle via `screen.getByRole("button", { name: /Server/ })`
- **AND** all existing tests in `server-panel.test.tsx` SHALL continue to pass without other modifications

### Requirement: Coverage for Right-aligned Server Name
The test suite SHALL include at least one new test verifying that the active server name is rendered in the header (outside the collapsed content area) — making the right-slot contract behavior-tested, not just visually verified.

#### Scenario: Server name visible in header before panel is opened
- **GIVEN** a freshly rendered `ServerPanel` with active server `work` and the panel in its default-closed state (`defaultOpen={false}` — no `openPanel()` call)
- **WHEN** the DOM is queried for the active server name
- **THEN** an element with text `work` is present in the document header region
- **AND** the static title `Server` is also present in the header

## Design Decisions

1. **Static title `"Server"` over keeping `"Tmux"`**: Both `"Pane"` and `"Host"` are singular nouns describing the panel's subject. `"Server"` extends that convention directly. Keeping `"Tmux"` would technically satisfy right-alignment of the name alone, but would leave the Server panel's title semantically different from its siblings (naming the underlying technology rather than the content). The intake-level user phrasing — "Follow the pattern used in the Pane panel and the Host panel" — is interpreted to include this title convention, not just the alignment mechanic.
   - *Why*: Matches the in-repo convention already codified in `status-panel.tsx:80` and `host-panel.tsx:45`; one more consistent data point makes the pattern obvious to future sidebar work.
   - *Rejected*: `"Tmux"` alone — preserves less of the pattern. The dynamic `` `Tmux · ${server}` `` form — rejected by the user's request.

2. **Server name styled `text-text-primary font-mono` (Host precedent) over `text-text-secondary` (Pane precedent)**: Host's hostname is the closer analogue: both are primary identifiers of a machine/server-level context. Pane's window name is narrower in scope. The Server panel already tints the left stripe of the *active* tile using the server's assigned ANSI color — the header name is a redundant breadcrumb, but one the user reads first when deciding whether to switch servers; primary-text visibility helps that read.
   - *Why*: Host precedent is the closest analogue; easy to flip later if design feedback prefers secondary.
   - *Rejected*: `text-text-secondary` (Pane precedent) — demotes the breadcrumb when it's functionally important to the Server panel's purpose.

3. **Spinner rendered after the server name, not before**: `HostPanel` renders `hostname → status-dot` in `headerRight`. Keeping the variable identifier first and the status indicator second preserves a consistent scan order across both panels and keeps the most important token (the identifier) at the same left-to-right position in the right slot regardless of refresh state.
   - *Why*: Consistency with Host; fixes identifier position across refresh transitions.
   - *Rejected*: Spinner first, name second — would reposition the name each time `refreshing` flips.

4. **Behavior-level test for the header right-slot, not a snapshot**: A snapshot test would over-specify the classnames and catch unrelated Tailwind refactors. A behavior test asserting "the server name is present in the document header region even when the panel body is closed" directly encodes the right-slot contract (since the closed body hides tile names, any name present in the DOM must be coming from the header).
   - *Why*: Durable against unrelated styling tweaks; test encodes the contract, not the implementation.
   - *Rejected*: Snapshot test — brittle; DOM-class assertions — couple tests to styling.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `CollapsiblePanel` right-aligns `headerRight` via an `ml-auto flex items-center gap-1 min-w-0 truncate` wrapper, applied unconditionally when `headerRight` is set | Confirmed from intake #1; re-verified at `collapsible-panel.tsx:281-285` during spec generation | S:95 R:90 A:95 D:90 |
| 2 | Certain | `HostPanel` and `WindowPanel` both use the fixed-title + `headerRight` pattern for their variable identifiers | Confirmed from intake #2; re-verified at `host-panel.tsx:32-45` and `status-panel.tsx:72-88` | S:95 R:90 A:95 D:90 |
| 3 | Confident | New static title is `"Server"` (singular noun) — the user's "follow the pattern" phrasing is interpreted to include title convention, not just right-alignment | Upgraded from intake #3: spec-level analysis of the Design Decision confirms no competing signal for keeping `"Tmux"`. Still <Certain because it's a naming choice — flip-cost is ~1 line if design review disagrees | S:80 R:90 A:80 D:75 |
| 4 | Confident | Server name uses `text-text-primary font-mono` with `truncate` — Host precedent | Confirmed from intake #4. Primary-text treatment reflects the identifier's weight; easily flipped | S:70 R:90 A:75 D:60 |
| 5 | Confident | `LogoSpinner` sibling renders after the server name in `headerRight` while `refreshing` is true | Confirmed from intake #5 with the additional design rationale (consistent scan order across refresh transitions) | S:75 R:90 A:80 D:75 |
| 6 | Certain | `openPanel` helper in `server-panel.test.tsx` must change its regex from `/Tmux/` to `/Server/` | Mechanical necessity — the title string is the sole match site (`server-panel.test.tsx:53`). Changing the title without updating the helper would deterministically break every test that calls `openPanel()` | S:95 R:95 A:95 D:95 |
| 7 | Certain | A new test SHALL cover the right-slot placement of the server name | `fab/project/code-quality.md` mandates: "New features and bug fixes MUST include tests covering the added/changed behavior" — this is a code-quality rule, not a judgment call | S:90 R:90 A:95 D:90 |
| 8 | Confident | No updates required to `docs/memory/run-kit/ui-patterns.md` | Confirmed during spec generation — the existing ServerPanel description (line 150) focuses on the tile grid, hover actions, and mobile layout; it does not describe title/header placement at the granularity this change touches | S:70 R:85 A:75 D:70 |
| 9 | Certain | No other `ServerPanel` props or body behavior changes | Explicit non-goal in intake and reinforced by a dedicated spec requirement ("No Other Header Behavior Changes"). Scope is bounded by the spec itself — deviation would contradict a SHALL-keyword requirement | S:95 R:90 A:95 D:95 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
