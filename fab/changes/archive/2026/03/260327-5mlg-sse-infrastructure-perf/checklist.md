# Quality Checklist: SSE Infrastructure Performance

**Change**: 260327-5mlg-sse-infrastructure-perf
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Server-indexed client map: `sseHub.clients` is `map[string][]*sseClient`
- [x] CHK-002 RLock for reads: `poll()` uses `RLock()` for server-key collection and client-count check
- [x] CHK-003 Lock for writes: `poll()` uses `Lock()` for broadcast and `previousJSON` update
- [x] CHK-004 Channel buffer 32: `handleSSE` creates client with `make(chan []byte, 32)`
- [x] CHK-005 Drop logging: `slog.Warn("SSE event dropped")` emitted on first buffer-full per client
- [x] CHK-006 Drop debounce: `dropped` boolean prevents spam; reset on successful send
- [x] CHK-007 Relay race fix: reader goroutine calls `cleanup()` not `conn.Close()`

## Behavioral Correctness
- [x] CHK-008 addClient appends to server slice and sends cached snapshot
- [x] CHK-009 removeClient uses swap-delete; deletes map key when slice empty
- [x] CHK-010 poll() stops when total clients across all slices is 0
- [x] CHK-011 SSE event format unchanged (external behavior preserved)

## Scenario Coverage
- [x] CHK-012 Adding clients to different servers creates separate slices
- [x] CHK-013 Removing last client for a server deletes the key
- [x] CHK-014 PTY read failure triggers cleanup(), not conn.Close()
- [x] CHK-015 Main goroutine exits cleanly after reader cleanup

## Edge Cases & Error Handling
- [x] CHK-016 Concurrent add/remove during poll does not race
- [x] CHK-017 Empty hub (no clients) stops polling gracefully
- [x] CHK-018 Both goroutines exiting simultaneously handled by sync.Once

## Code Quality
- [x] CHK-019 Pattern consistency: new code follows existing Go patterns in api/ package
- [x] CHK-020 No unnecessary duplication: reuses existing cleanup() pattern
- [x] CHK-021 All subprocess calls use exec.CommandContext with timeouts (constitution)
- [x] CHK-022 No shell string construction (constitution)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
