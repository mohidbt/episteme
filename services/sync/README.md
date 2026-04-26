# @episteme/sync

Real-time collaborative editing backend. Hosts a self-managed [Hocuspocus](https://tiptap.dev/hocuspocus) WebSocket server that syncs Yjs documents for notes. Authentication (Better Auth session cookie) and persistence (Postgres via `@episteme/db`) are wired in Tasks 2 and 3 of Phase 1.0.

**Run locally:**
```
pnpm -F @episteme/sync dev
```

**Plan:** `docs/superpowers/plans/phases/phase-1.0-yjs.md`

**Production hosting:** Fly.io — long-lived WebSocket connections are incompatible with serverless platforms like Vercel.
