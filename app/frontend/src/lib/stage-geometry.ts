/** The stage ground's padding on every side; the content column's left edge
 *  is STAGE_PADDING_PX + sidebarWidth + STAGE_COLUMN_GAP_PX while the sidebar
 *  is open. DOM-free so Playwright e2e specs (Node-side, outside the
 *  component graph) can assert against the same numbers — shell.tsx
 *  re-exports both for its component-graph consumers. */
export const STAGE_PADDING_PX = 6;

/** The gap between the sidebar track and the content column while the sidebar is open. */
export const STAGE_COLUMN_GAP_PX = 6;
