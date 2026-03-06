# Quality Checklist: Navbar Breadcrumb Dropdowns

## Functional Completeness
- [ ] Project dropdown appears on project page with all sessions listed
- [ ] Project dropdown appears on terminal page with all sessions listed
- [ ] Window dropdown appears on terminal page with all windows listed
- [ ] Current item highlighted in both dropdowns
- [ ] Selecting a project navigates to `/p/{name}`
- [ ] Selecting a window navigates to `/p/{project}/{index}?name={name}`
- [ ] Dashboard breadcrumbs unchanged (no dropdown)

## Behavioral Correctness
- [ ] Clicking label/name navigates (terminal page project link) — does NOT open dropdown
- [ ] Clicking chevron opens dropdown — does NOT navigate
- [ ] Outside click dismisses dropdown
- [ ] Escape key dismisses dropdown
- [ ] ArrowUp/ArrowDown navigates dropdown items
- [ ] Enter selects focused dropdown item
- [ ] Only one dropdown open at a time

## Edge Cases
- [ ] Single session — dropdown with one item (current, highlighted)
- [ ] Single window — dropdown with one item
- [ ] Session/window list updates via SSE while dropdown is open (dropdown reflects latest data)
- [ ] Long project/window names don't break dropdown layout

## Security
- [ ] No shell injection vectors (feature is client-side only, navigation via Next.js Link)
