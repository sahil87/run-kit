# Quality Checklist: Fixed Chrome Architecture

**Change**: 260305-emla-fixed-chrome-architecture
**Generated**: 2026-03-06
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Root layout owns chrome skeleton: layout.tsx has h-screen flex-col with three zones (top shrink-0, content flex-1, bottom shrink-0)
- [ ] CHK-002 ChromeProvider context: src/contexts/chrome-context.tsx exports provider with breadcrumbs, line2Left, line2Right, bottomBar slots
- [ ] CHK-003 TopBarChrome component: src/components/top-bar-chrome.tsx reads from context, renders two fixed-height lines
- [ ] CHK-004 Line 2 always rendered: min-h-[36px] on Line 2, no conditional rendering
- [ ] CHK-005 Icon breadcrumbs: RK logo placeholder, ⬡ for projects, ❯ for windows, no text prefixes
- [ ] CHK-006 Connection indicator: green dot + "live" when connected, gray dot + "disconnected" when not
- [ ] CHK-007 Dashboard rewiring: no TopBar render, sets breadcrumbs/line2 via useEffect, cleanup on unmount
- [ ] CHK-008 Project rewiring: no TopBar render, sets breadcrumbs with ⬡ icon, line2 with buttons and count
- [ ] CHK-009 Terminal rewiring: no TopBar render, no h-screen/max-w-[900px], terminal div is flex-1 min-h-0
- [ ] CHK-010 Kill button always visible: no opacity-0 group-hover:opacity-100 on SessionCard kill button
- [ ] CHK-011 BottomSlot exists in layout: empty shrink-0 div rendered for future change 2/3
- [ ] CHK-012 max-w-4xl everywhere: both chrome and content zones use max-w-4xl mx-auto w-full px-6

## Behavioral Correctness

- [ ] CHK-013 No layout shift on navigation: top bar width/padding/position identical across all three pages
- [ ] CHK-014 Content zone scrolls, chrome fixed: long session lists scroll within content zone only
- [ ] CHK-015 Breadcrumb segments are links: all segments except the last are clickable and navigate correctly
- [ ] CHK-016 Context cleanup on unmount: navigating away resets breadcrumbs to [] and line2 slots to null

## Removal Verification

- [ ] CHK-017 TopBar removed: src/components/top-bar.tsx deleted, no imports remain in any file

## Scenario Coverage

- [ ] CHK-018 Dashboard renders logo only in breadcrumb area (no segments)
- [ ] CHK-019 Terminal breadcrumb shows RK › ⬡ projectName › ❯ windowName with correct links
- [ ] CHK-020 Terminal xterm.js fills available vertical space under layout-owned container
- [ ] CHK-021 Kill button visible and tappable without hover (no opacity transition)

## Edge Cases & Error Handling

- [ ] CHK-022 Line 2 height stable when slots are empty (before useEffect fires on initial render)
- [ ] CHK-023 FitAddon resize works: terminal correctly re-fits on browser resize under new layout

## Code Quality

- [ ] CHK-024 Pattern consistency: new code follows naming and structural patterns of surrounding code
- [ ] CHK-025 No unnecessary duplication: existing utilities (useSessions, useKeyboardNav) reused
- [ ] CHK-026 execFile with argument arrays: no exec() or template-string shell commands introduced
- [ ] CHK-027 No useEffect for data fetching: context setters are side-effect only, not data fetching
- [ ] CHK-028 Client Components only where needed: ChromeProvider and TopBarChrome are Client Components, layout remains Server Component
- [ ] CHK-029 No polling from client: no setInterval + fetch introduced
- [ ] CHK-030 No database imports: no ORM/migration/persistent state introduced

## Security

- [ ] CHK-031 No shell injection: no new subprocess calls; existing execFile patterns preserved
