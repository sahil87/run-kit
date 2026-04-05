# Quality Checklist: Hostname in Browser Title

**Change**: 260320-uq0k-hostname-browser-title
**Generated**: 2026-03-20
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Hostname at startup: `os.Hostname()` called once at startup, stored in `Server` struct
- [x] CHK-002 Health endpoint: `GET /api/health` returns `{"status":"ok","hostname":"..."}` with actual hostname
- [x] CHK-003 Frontend fetch: `getHealth()` function exists in API client and returns hostname
- [x] CHK-004 Dashboard title: `document.title` is `RunKit — {hostname}` on `/`
- [x] CHK-005 Terminal title: `document.title` is `{session}/{window} — {hostname}` on `/:session/:window`

## Behavioral Correctness
- [x] CHK-006 Health response shape: Response includes both `status` and `hostname` fields (not just `status`)
- [x] CHK-007 Title updates on navigation: Title changes when switching between dashboard and terminal routes

## Scenario Coverage
- [x] CHK-008 Empty hostname fallback: When `os.Hostname()` fails, health returns `"hostname":""` and title omits hostname suffix
- [x] CHK-009 Title with hostname on dashboard: Verified via test
- [x] CHK-010 Title with hostname on terminal page: Verified via test
- [x] CHK-011 Title navigation update: Title changes when navigating from dashboard to terminal and back

## Edge Cases & Error Handling
- [x] CHK-012 Hostname failure non-fatal: Server starts normally even if `os.Hostname()` errors
- [x] CHK-013 Static fallback preserved: `<title>RunKit</title>` in `index.html` unchanged

## Code Quality
- [x] CHK-014 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [x] CHK-015 No unnecessary duplication: Existing utilities reused where applicable
- [x] CHK-016 Readability: Code is readable and maintainable over clever
- [x] CHK-017 Subprocess safety: No new subprocess calls introduced (hostname is `os.Hostname()`, not shell)
- [x] CHK-018 No polling: Hostname fetched once, not on interval
- [x] CHK-019 No magic strings: Title format uses clear constants or inline values with obvious meaning

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
