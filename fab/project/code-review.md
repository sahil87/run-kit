# Code Review

## Severity Definitions

- **Must-fix**: Spec mismatches, failing tests, checklist violations, security issues (exec/injection), tmux session leaks (panes not cleaned up on disconnect)
- **Should-fix**: Code quality issues, pattern inconsistencies, missing keyboard shortcuts for new actions, Client Component that could be a Server Component
- **Nice-to-have**: Style suggestions, minor improvements, additional type narrowing

## Review Scope

- Changed files only (files touched during apply)
- Skip generated code: `node_modules/`, `.next/`, `components/ui/` (shadcn/ui generated)
- Skip binary files and assets
- Skip `fab/.kit/` (upstream fab-kit, not project code)

## False Positive Policy

- Inline `<!-- review-ignore: {reason} -->` in markdown files
- Inline `// review-ignore: {reason}` or `# review-ignore: {reason}` in code files
- Suppressed findings are noted in the review report but not counted as failures

## Rework Budget

- Max cycles: 3
- After 2 consecutive "fix code" attempts on the same issue, escalate to "revise tasks" or "revise spec"

## Project-Specific Review Rules

- All `execFile` calls must include a timeout parameter
- No `exec()`, `execSync()`, or template-string shell commands — flag as must-fix security issue
- WebSocket connections must have corresponding cleanup (pane kill on disconnect)
- New keyboard shortcuts must be documented in the command palette registration
- API routes must not block on tmux operations longer than 5 seconds — use timeouts
- Terminal relay code must handle connection drops gracefully (no orphaned panes)
- SSE endpoints must handle client disconnection without throwing
