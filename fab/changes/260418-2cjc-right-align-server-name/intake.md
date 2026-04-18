# Intake: Right-align Server Name in Server Panel Header

**Change**: 260418-2cjc-right-align-server-name
**Created**: 2026-04-18
**Status**: Draft

## Origin

One-shot `/fab-new` invocation. User's raw input:

> In the Server panel header, keep the server name right aligned. Follow the pattern used in the Pane panel and the Host panel.

The user has explicitly named the reference pattern (Pane panel, Host panel) so the target behavior is concrete. No back-and-forth was needed — the existing codebase already implements the desired pattern in two neighboring components, leaving only a straightforward alignment of the Server panel with that convention.

## Why

The sidebar has three stacked `CollapsiblePanel` instances — Server, Host, Pane — that share the same header chrome (chevron, title, optional right-side content, optional action button). Two of them follow a consistent visual pattern:

- **Pane panel** (`status-panel.tsx:72-88`): fixed title `"Pane"`, active window name passed via `headerRight`, which is rendered with `ml-auto` by `CollapsiblePanel` so it flushes to the right edge of the header.
- **Host panel** (`host-panel.tsx:31-45`): fixed title `"Host"`, hostname + connectivity dot passed via `headerRight`, same right-alignment behavior.

The **Server panel** (`server-panel.tsx:97`) breaks this pattern by concatenating the active server name into the title itself:

```tsx
title={`Tmux \u00B7 ${server}`}
```

Consequences:

1. Visual inconsistency — across the three panels, the only variable identifier (server name / hostname / window name) lives on the left in Server but on the right in Pane and Host.
2. Truncation behavior differs — `title` is inside the flex-1 button area in `CollapsiblePanel`, while `headerRight` is in a dedicated `ml-auto flex min-w-0 truncate` container with its own truncation. Long server names currently push the title layout instead of truncating in the name slot.
3. The existing server-only `headerRight` (the `LogoSpinner` shown while refreshing) is the only right-side content — adding the server name there is a natural fit and mirrors how Host combines hostname + status dot in `headerRight`.

Doing nothing leaves a small but visible UI inconsistency across the sidebar. The fix is scoped to a single file.

## What Changes

### server-panel.tsx — split server name out of the title

Change `ServerPanel`'s `<CollapsiblePanel …>` invocation to:

1. Replace the dynamic title `\`Tmux \u00B7 ${server}\`` with a fixed title. Use `"Server"` to match the singular-noun convention of `"Pane"` and `"Host"` in the neighboring panels.
2. Compose `headerRight` so it contains the server name on the right, plus the existing `LogoSpinner` when `refreshing` is true. Follow the Host panel precedent — multiple nodes rendered as siblings inside `headerRight`, which `CollapsiblePanel` wraps in a right-aligned `ml-auto flex items-center gap-1 min-w-0 truncate` span.

Concretely, the new `headerRight` value should look like:

```tsx
const headerRight = (
  <>
    <span className="truncate text-text-primary font-mono">{server}</span>
    {refreshing && <LogoSpinner size={10} />}
  </>
);
```

Notes on styling:

- Use `text-text-primary font-mono` for the server name, mirroring `host-panel.tsx:34` (`<span className="truncate text-text-primary font-mono">{metrics.hostname}</span>`). The existing Pane panel uses `text-text-secondary` for the window name; Host uses `text-text-primary`. Server names are user-visible identifiers on par with hostnames, so the Host treatment is the closer analogue.
- The `LogoSpinner` appears to the right of the server name when refreshing, matching Host's hostname-then-dot ordering. This preserves the current "spinner visible while refreshing" behavior without disturbing the name.
- Do not change `storageKey`, `defaultOpen`, `onToggle`, `contentClassName`, `headerAction`, `tint`, `tintOnlyWhenCollapsed`, `resizable`, `defaultHeight`, `minHeight`, `mobileHeight`, or any body rendering — scope is limited to the header's title / headerRight.

### server-panel.test.tsx — update title assertion if needed

If `server-panel.test.tsx` asserts on the old `"Tmux · <name>"` title string, update the assertion to match the new split (title `"Server"`, server name rendered in the right slot). Otherwise no test changes required. This will be confirmed during implementation by reading the test file.

## Affected Memory

No memory updates required. The sidebar panel patterns are implementation-level conventions that are directly observable in the three panel components (`server-panel.tsx`, `host-panel.tsx`, `status-panel.tsx`) and the shared `collapsible-panel.tsx`. No `docs/memory/` entry currently documents panel header conventions, and this change does not introduce a new cross-cutting convention — it merely brings one component into line with an existing, visible pattern.

## Impact

- **Files touched**: `app/frontend/src/components/sidebar/server-panel.tsx` (primary), and potentially `app/frontend/src/components/sidebar/server-panel.test.tsx` if it asserts on the old title string.
- **APIs / props**: No changes to `ServerPanel`'s props, no changes to `CollapsiblePanel`'s API.
- **Dependencies**: None.
- **Risk**: Very low — single-file edit, purely visual, existing pattern in-repo confirmed in two other panels.
- **Visual regression surface**: Playwright snapshots or screenshot tests covering the sidebar header may need refreshing if they exist for the Server panel header. To be confirmed during apply.

## Open Questions

None. The target pattern is already implemented twice in the same directory, the user has named both references, and the existing `headerRight` slot trivially accommodates both the server name and the refresh spinner.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Target pattern is `CollapsiblePanel`'s `headerRight` prop, rendered right-aligned via `ml-auto flex items-center gap-1 min-w-0 truncate` in `collapsible-panel.tsx:281-285` | Confirmed by reading `collapsible-panel.tsx` — the `ml-auto` wrapper is unconditional whenever `headerRight` is set | S:95 R:90 A:95 D:90 |
| 2 | Certain | Pane and Host panels already follow this pattern — Pane (`status-panel.tsx:73-80`) and Host (`host-panel.tsx:32-45`) both use fixed titles and pass the identifier via `headerRight` | Confirmed by reading both files | S:95 R:90 A:95 D:90 |
| 3 | Confident | New Server panel title should be `"Server"` (singular noun) to match `"Pane"` and `"Host"` | Pane/Host use singular nouns describing the panel's content; `"Server"` extends that convention. Current `"Tmux · …"` is the only dynamic-title panel. User said "follow the pattern" — singular-noun title is part of that pattern | S:75 R:85 A:80 D:70 |
| 4 | Confident | Server name uses `text-text-primary font-mono` (Host precedent) rather than `text-text-secondary` (Pane precedent) | Host's hostname treatment is the closer analogue: both are primary identifiers of a machine/server-level context. Pane's secondary color is used for a window name, a narrower scope. Easy to flip later if design review disagrees | S:65 R:90 A:75 D:55 |
| 5 | Confident | When refreshing, the `LogoSpinner` renders to the right of the server name inside `headerRight` | Mirrors Host's hostname-then-dot ordering; preserves existing refresh-indication behavior without disturbing the newly right-aligned name | S:70 R:90 A:80 D:70 |
| 6 | Confident | Test file `server-panel.test.tsx` may need its title assertion updated; other behavior is unchanged | Standard practice when a visible string changes; confirmed only at apply-time by reading the test | S:70 R:95 A:85 D:80 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
