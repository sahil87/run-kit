---
type: memory
description: "Removal ledger: tombstone rows relocated from generated domain indexes when a memory file retires — each row preserves the retired file's scope, cited to the removing change."
---
# Removed Memory Files

Tombstone rows relocated from domain indexes when a memory file is retired (FKF §3.3's sanctioned removal-record exception). Indexes are regenerated from folder contents; this ledger is where a retired file's index-row scope survives.

From `run-kit/ui/index.md` (removed by 260904-39bp-remove-chat-lens):

| [chat-view](chat-view.md) | The ?view=chat lens frontend: TS mirror of the rk-owned chat schema, pure derivation helpers (dedup/turn-group/tool-pair/pending), the useChatSubscription hook (one guarded compose for mount + reconnect), the read-only ChatView renderer (react-markdown + remark-gfm), the ChatSendForm input wired by AppShell, lens-machinery view state, center heading, connection dot = stream health, WaitingBadge deep-link, and the shared Enter-policy classifier. |
