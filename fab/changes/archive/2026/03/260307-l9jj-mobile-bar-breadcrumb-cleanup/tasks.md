# Tasks: Mobile Bottom Bar & Breadcrumb Cleanup

**Change**: 260307-l9jj-mobile-bar-breadcrumb-cleanup
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 [P] Merge extended keys into function key popup in `src/components/bottom-bar.tsx`: combine `FN_KEYS` and `EXT_KEYS` into a single popup under `F▴` button with a divider (`border-t border-border`) between the F1-F12 grid (4-col) and PgUp/PgDn/Home/End/Ins/Del grid (3-col). Remove `extOpen` state, `extRef` ref, and the `⋯` button. Keep `EXT_KEYS` array as data.
- [x] T002 [P] Remove upload button from `src/components/bottom-bar.tsx`: delete the `📎` button, hidden `<input type="file">`, `uploadInputRef`, and `onUploadFiles` from `BottomBarProps`. Update all callers passing `onUploadFiles` to `BottomBar`.
- [x] T003 [P] Add upload button to `src/components/compose-buffer.tsx`: add `onUploadFiles` to `ComposeBufferProps`, add hidden `<input type="file" multiple>` + paperclip button to the left of Send in the `flex justify-end mt-2` row. Wire click to open file picker, onChange to call `onUploadFiles`.
- [x] T004 [P] Add keyboard dismiss button in `src/components/bottom-bar.tsx`: add a `⌄` (chevron down, `\u2304`) button after the `F▴` dropdown, styled with `KBD_CLASS`, `aria-label="Dismiss keyboard"`, onClick calls `document.activeElement?.blur()`.
- [x] T005 [P] Make breadcrumb icon the dropdown trigger in `src/components/breadcrumb-dropdown.tsx`: add `icon` prop to `Props`, render icon as button content instead of `▾`. Update button styling to match icon presentation.
- [x] T006 [P] Update `src/components/top-bar-chrome.tsx`: pass `icon={crumb.icon}` to `BreadcrumbDropdown`, remove the passive `<span aria-hidden="true">{crumb.icon}</span>` that currently renders the icon separately.

## Phase 2: Integration

- [x] T007 Wire `onUploadFiles` from terminal page to `ComposeBuffer` instead of `BottomBar`. Find the terminal page component that currently passes `onUploadFiles` to `BottomBar` and redirect it to `ComposeBuffer`.
- [x] T008 Verify type check passes: run `npx tsc --noEmit` and fix any type errors from the prop changes.

## Phase 3: Verification

- [x] T009 Run `pnpm build` to verify production build succeeds with all changes.

---

## Execution Order

- T001-T006 are independent, can run in parallel (different files or non-overlapping sections)
- T007 depends on T002 + T003 (upload prop moved before wiring)
- T008 depends on T001-T007
- T009 depends on T008
