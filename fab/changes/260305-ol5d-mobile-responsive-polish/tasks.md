# Tasks: Mobile Responsive Polish

**Change**: 260305-ol5d-mobile-responsive-polish
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Define `coarse:` custom Tailwind variant in `src/app/globals.css` — add `@custom-variant coarse (@media (pointer: coarse));`
- [x] T002 Add `palette:open` event listener to `src/components/command-palette.tsx` — listen for `palette:open` CustomEvent on `document`, open palette when received (reset query, selection, focus input)

## Phase 2: Core Implementation

- [x] T003 Implement Line 2 mobile collapse in `src/components/top-bar-chrome.tsx` — wrap `line2Left` in `hidden sm:block`, reposition `line2Right` left-aligned on mobile, add `⋯` button (visible below `sm:`) that dispatches `palette:open` event
- [x] T004 [P] Hide `⌘K` badge on mobile in `src/components/top-bar-chrome.tsx` — add `hidden sm:inline-flex` to the `⌘K` kbd element
- [x] T005 [P] Responsive container padding in `src/app/layout.tsx` and `src/contexts/chrome-context.tsx` — change `px-6` to `px-3 sm:px-6` in top chrome wrapper (layout.tsx:34), ContentSlot inner wrapper (chrome-context.tsx:103), and BottomSlot inner wrapper (chrome-context.tsx:114)
- [x] T006 [P] Bottom bar 44px height in `src/components/bottom-bar.tsx` — change `KBD_CLASS` from `min-h-[30px]` to `min-h-[44px]`
- [x] T007 [P] Responsive terminal font in `src/app/p/[project]/[window]/terminal-client.tsx` — use `window.matchMedia('(min-width: 640px)')` at init to set `fontSize: 11` on mobile, `fontSize: 13` on desktop

## Phase 3: Touch Target Audit

- [x] T008 [P] Touch targets on Line 2 action buttons — add `coarse:min-h-[44px]` to all action buttons set via `setLine2Left` in `src/app/dashboard-client.tsx`, `src/app/p/[project]/project-client.tsx`, and `src/app/p/[project]/[window]/terminal-client.tsx`
- [x] T009 [P] Touch targets on session card kill button in `src/components/session-card.tsx` — add `coarse:min-h-[44px] coarse:min-w-[44px]` to ✕ button and padding for tap area
- [x] T010 [P] Touch targets on session group kill button in `src/app/dashboard-client.tsx` — add `coarse:min-h-[44px] coarse:min-w-[44px]` to session header ✕ button
- [x] T011 [P] Touch targets on breadcrumb dropdown chevron in `src/components/breadcrumb-dropdown.tsx` — change `min-h-[24px]` to `min-h-[24px] coarse:min-h-[44px]` and similarly for width
- [x] T012 [P] Touch target on `⋯` button in `src/components/top-bar-chrome.tsx` — ensure `coarse:min-h-[44px]`
- [x] T013 [P] Touch target on dashboard search input in `src/app/dashboard-client.tsx` — add `coarse:min-h-[44px]` to the search input

## Phase 4: Verification

- [x] T014 Type check — run `npx tsc --noEmit` and fix any errors
- [x] T015 Production build — run `pnpm build` and fix any errors

---

## Execution Order

- T001 and T002 are prerequisites for T003-T013 (variant must exist, palette event must be handled)
- T003 blocks T012 (the `⋯` button is created in T003, touch target applied in T012)
- T004-T007 are independent of each other, can run in parallel after T001-T002
- T008-T013 are all independent, can run in parallel after T001-T003
- T014-T015 run sequentially after all implementation tasks
