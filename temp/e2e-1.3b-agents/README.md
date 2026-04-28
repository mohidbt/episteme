# Phase 1.3b — Agent E2E Test Suite Brief

> Brief for a fresh agent to execute end-to-end verification of Phase 1.3b deliverables on branch `wt/1.3b-agents` (worktree at `.claude/worktrees/1.3b-agents`).

## Goal

Machine-verify the master-spec exit criteria for Phase 1.3b before merging into `main`:

1. `/agent lit-triage` runs end-to-end: agent reads `/memories/research-interests.md`, delegates to `researcher` subagent, classifies hits (must-read / skim / skip), proposes `create_note(...)`, SSE yields `interrupt`, `POST /resume {approve:true}` completes the call, note appears in DB.
2. `/agent deep-read <pdf_id>` runs against a seeded PDF: agent calls `extract_passages` + `highlight` + `get_page_text`, produces a summary note with `[[pdf:<id>#p<N>]]` anchors via `create_note`.
3. `/agent synthesis` with 3 seeded `note_ids` drafts to `/scratch/<topic>.md` with every claim citation-tagged, unsupported claims flagged with `⚠ unsupported`.
4. Guest user_id `/agents/km/invoke` returns 403 with `{error, code:"guest_forbidden"}`.
5. Toggling a skill off via `PATCH /api/agents/km/config` removes that skill's tools from `/state/:thread` manifest on the next invoke.
6. HITL: `make_public` always pauses on an interrupt regardless of model output.
7. Cross-session memory: write `/memories/research-interests.md`, restart agents service, read it back in a new thread.
8. `tsx scripts/check-skill-addition.ts` exits 0.
9. `pytest services/agents/tests` green minus 7 pre-existing fixture failures (`apps/web/e2e/fixtures/test.pdf` missing — unrelated).

## What's already done (do not re-test, but rely on)

- T0: Backend HTTP routes for `search_notes`, `list_references`, `create_note`, `extract_passages`, `highlight`, `get_page_text`, `read_note`. Dual-auth (Better Auth cookie OR `X-Inhale-Sig` HMAC). See `apps/km/src/lib/internal-auth.ts` and `apps/reader/src/lib/internal-auth.ts`. Cross-language signing locked by golden vector test.
- T5: `services/agents/skills/__init__.py::load_skills(only=...)` + 3 `SKILL.md` files (lit-triage, deep-read, synthesis). Tool allow-list filtering + per-skill HITL injection.
- T6: `services/agents/subagents/{researcher,synthesizer,verifier}.py`. Verifier is `CompiledSubAgent` wrapping a LangGraph `StateGraph`. MCP loader skips disabled servers gracefully.
- T12: `scripts/check-skill-addition.ts` proves PRD §5.4.7 — fixture skill plug-in causes zero diff outside `services/agents/skills/`.
- T13: Guest sentinel — `lib/config_cache.GUEST_USER_ID = "guest"`, all 4 `/agents/km/*` routes return 403 for guest.

## Out of scope for THIS suite

- UI Playwright tests (no agents UI exists yet — 1.3c builds it).
- Performance / load tests.
- LLM behavior assertions beyond protocol-level (we cannot deterministically assert LLM picks "must-read" vs "skim"; we DO assert the agent emits the expected SSE event sequence and tool calls).
- Frontend integration tests.

## Required environment

- Postgres 17 reachable on `EPISTEME_AGENTS_PG_URL` (default: `postgresql://postgres:postgres@localhost:5433/episteme_dev`). Worktree note: do NOT spin a second `docker compose` MinIO/Postgres in the worktree — port clash on 9000/5433 + empty volume. Reuse the main checkout's running services.
- MinIO reachable on `localhost:9000` for PDF storage.
- `INHALE_INTERNAL_SECRET` set (any value — agents service + apps must agree).
- `INHALE_LLM_KEY` for OpenRouter — needed for tests that exercise LLM. Without it: skip those scenarios with a `pytest.skip` marker, do not fail.
- `apps/km` running on `localhost:3001` (or wherever the project's km dev port is).
- `apps/reader` running on `localhost:3000` (or project's reader dev port).
- `services/agents` running on `localhost:8000` (uvicorn). Use the lifespan path that opens `AsyncPostgresSaver`/`AsyncPostgresStore`.

If any service isn't running: stop and ask user to start them via the **main checkout** (`.claude/worktrees/1.3b-agents` is for code, NOT for live services).

## Suite layout to produce

```
temp/e2e-1.3b-agents/
├── README.md                     # this file
├── conftest.py                   # pytest fixtures: seeded user, PDF, notes
├── helpers/
│   ├── http.py                   # signed HTTP client (mirrors lib/km_http.py signer)
│   ├── sse.py                    # SSE event parser/iterator
│   └── seed.py                   # DB seed: user, library, notes, PDF
├── test_lit_triage_e2e.py        # Scenario 1 (HITL roundtrip)
├── test_deep_read_e2e.py         # Scenario 2 (PDF + highlights + summary)
├── test_synthesis_e2e.py         # Scenario 3 (scratch markdown + citations)
├── test_guest_e2e.py             # Scenarios 4 + 6 (guest 403, HITL on make_public)
├── test_skill_toggle_e2e.py      # Scenario 5 (toggle off → manifest absent)
├── test_memory_e2e.py            # Scenario 7 (cross-session memory)
└── test_scalability_gate.py      # Scenario 8 (script wrapper)
```

## Per-scenario specs

### 1. test_lit_triage_e2e.py — HITL roundtrip on `create_note`

**Setup:**
- Create user `e2e_user_1`, library, default notebook (id `inbox`).
- Seed `/memories/research-interests.md` for the user via store: `["spiking neural networks", "neuromorphic hardware"]`.
- Enable skill `lit-triage` via `POST /agents/km/config`.

**Steps:**
1. POST `/agents/km/invoke` with `{thread_id: <uuid>, message: "Run lit-triage today"}`.
2. Stream SSE. Collect every event by type.
3. Assert the stream contains:
   - At least one `tool_call` event with `name == "search_notes"` OR `name in {arxiv_search, biorxiv_search, pubmed_search}` (when MCP enabled — skip if `mcps.yaml` has all servers disabled).
   - Exactly one `interrupt` event whose `tool == "create_note"` and `args.title` matches `/Inbox — \d{4}-\d{2}-\d{2}/`.
   - The stream ends with `done` after the interrupt (agent paused, awaiting resume).
4. POST `/agents/km/resume` with `{thread_id: <same uuid>, decisions: [{approve: true}]}`.
5. Stream SSE for the resume. Assert:
   - One `tool_result` event for `create_note` with `state == "output-available"`.
   - Final `done` event.
6. Verify DB: a row in `notes` table with the matching title + user_id. Body contains the bucket markdown structure (`## Must read`, `## Skim`, `## Skip`).

**Skip if:** `INHALE_LLM_KEY` not set.

**Fail conditions:** missing interrupt, wrong tool name on interrupt, agent invokes `create_note` without HITL, no row in DB after resume.

### 2. test_deep_read_e2e.py — PDF + highlights + summary note

**Setup:**
- Create user `e2e_user_2`.
- Seed a small PDF (e.g. 3-page test fixture in `temp/e2e-1.3b-agents/fixtures/sample.pdf` — generate one if missing using `reportlab` or download a CC0 sample). Insert into `documents` table with the file in MinIO bucket `pdfs/<doc_id>/source.pdf`. Run the chandra-segments / page-text extraction pipeline if needed.
- Enable skill `deep-read`.

**Steps:**
1. POST `/agents/km/invoke` with `{thread_id, message: "Deep read pdf {doc_id}"}`.
2. Stream SSE. Assert:
   - `tool_call` for `extract_passages` with `args.pdf_id == doc_id`.
   - At least one `tool_call` for `highlight` (deep-read frontmatter has `highlight` in `require_approval` — so an `interrupt` must precede the actual call).
   - Resume the interrupt with approve.
   - `tool_call` for `get_page_text` (likely; not strictly required).
   - Final `tool_call` for `create_note` (HITL pauses if `write_note=require` rule active).
   - The resulting note `contentMd` contains at least one `[[pdf:<doc_id>#p\d+]]` anchor (regex match).
3. Verify `user_highlights` table has rows tied to `doc_id`.

**Skip if:** `INHALE_LLM_KEY` unset OR sample PDF fixture not preparable.

### 3. test_synthesis_e2e.py — Scratch draft + citations

**Setup:**
- User `e2e_user_3`.
- Seed 3 notes with distinct titles + content (e.g. "Note A — Hopfield networks", "Note B — sparse coding", "Note C — predictive coding") in the user's library.
- Enable skill `synthesis`.

**Steps:**
1. POST `/agents/km/invoke` with `{message: "Synthesize: predictive coding. Use note ids: <a,b,c>"}`.
2. Stream SSE. Assert:
   - `tool_call` for `search_notes` and/or `read_note` (3 reads expected).
   - The synthesizer subagent is invoked (see `tool_call` event with name like `synthesizer`).
   - The agent writes to `/scratch/predictive-coding.md` via deepagents `write_file` tool — verify state via `GET /agents/km/state/<thread_id>` exposes the scratch file in the file manifest.
   - The scratch markdown body contains at least one `[[Note]]` link OR a URL OR a PDF anchor for every paragraph (regex parse: each paragraph has at least one `[[...]]` or `http(s)://`). Paragraphs without citation must be prefixed with `⚠ unsupported`.
3. The agent does NOT call `create_note` without explicit user approval (synthesis SKILL.md says draft to /scratch first).

**Skip if:** `INHALE_LLM_KEY` unset.

### 4. test_guest_e2e.py — Guest 403 + make_public HITL

**Steps:**
1. POST `/agents/km/invoke` with HMAC headers using `X-Inhale-User-Id: guest`. Assert response status 403 + body `{"error": ..., "code": "guest_forbidden"}`.
2. Same for `/agents/km/resume`, `/agents/km/state/x`, `/agents/km/config`.
3. Repeat with non-guest user `e2e_user_1` and confirm 200 (smoke).
4. **make_public HITL:** with `e2e_user_1`, `enabled_skills=["lit-triage"]` (no make_public in allow-list). Inject a regression test that explicitly enables `make_public` (currently restricted; if the route is unreachable, mark this assertion `xfail` and document) — invoke a request that asks the agent to publish a note. Assert SSE yields `interrupt` for `make_public` regardless of `approval_rules.publish` setting (defense-in-depth from tool metadata).

**No LLM dependency for steps 1–3.** Step 4 needs LLM — skip if no key.

### 5. test_skill_toggle_e2e.py — Toggle off removes from manifest

**Steps:**
1. User `e2e_user_5`. `POST /agents/km/config` with `enabledSkills: ["lit-triage", "synthesis"]`.
2. `POST /agents/km/invoke` w/ a benign message. Stream SSE just enough to see the agent's first `tool_call`. Then `GET /agents/km/state/<thread_id>` (note: state endpoint does NOT yet enumerate tool manifest — confirm scope; if it doesn't, drive a tool_call and observe via the `tool_call` events instead).
3. Assert `extract_passages` (deep-read tool, NOT enabled) is NEVER called even when message asks "extract passages from anything".
4. `PATCH /api/agents/km/config` (Next.js) → `enabledSkills: ["synthesis"]`.
5. New thread, new invoke. Assert: agent has access to `search_notes`, `read_note` (synthesis tools); does NOT call `list_references` (lit-triage tool, no longer enabled).

**No LLM dependency** for step 1; LLM needed for behavioral assertions in 3+5. Mark as `pytest.mark.llm` and skip when no key — but still run the config PATCH round-trip + DB-check portion.

### 6. test_memory_e2e.py — Cross-session memory

**Steps:**
1. User `e2e_user_6`. Send `/agents/km/invoke` w/ message: "Remember: my research interest is photonic computing." Wait for `done`.
2. Inspect store — assert key `/memories/research-interests.md` for `e2e_user_6` contains "photonic computing".
3. **Restart the agents service** (graceful: kill uvicorn process, wait for port to close, restart, wait for `/openapi.json` ready). This is fragile — if you can't drive a process restart from the test, fall back to:
   - Open a fresh thread under same user, send "What are my research interests?", assert `text` events contain "photonic computing".
4. Confirm the store survived (Postgres-backed).

**Skip restart step if you cannot manage the service process.** The fresh-thread path still proves persistence across thread IDs.

### 7. test_scalability_gate.py — Script wrapper

**Steps:**
1. `subprocess.run(["pnpm", "tsx", "scripts/check-skill-addition.ts"], cwd=<repo_root>)`.
2. Assert exit code 0.
3. Assert stdout contains `"OK: PRD §5.4.7 scalability gate held"`.

**No env dependencies beyond what the script itself needs.**

## Execution rules

- Fresh DB schema per test where feasible — use a per-test schema or transactional rollback. If the project uses `apps/km/src/db/migrations/...`, run them once at session start, then truncate user-scoped tables (`notes`, `notebooks`, `agent_configs`, `user_highlights`, `documents` rows for `e2e_user_*`) between tests.
- Always tear down enabled skills (reset `agent_configs.enabled_skills = []` per user).
- Use `pytest_asyncio` for async tests.
- HMAC client must mirror `services/agents/lib/km_http.py` signer exactly. Cross-language golden-vector test already locks the format.
- Wherever the agent could legitimately produce variable output, assert the **structure** (event types, tool names, args schema) not the **content** (no asserting "must-read" vs "skim").
- Set a wall-clock timeout per scenario (60s default). Fail fast on stalled SSE.

## Pre-flight checks

Before running any test, the suite must:

1. `GET /openapi.json` on agents service → 200.
2. `GET /api/health` (or equivalent) on apps/km → 200.
3. `GET /api/health` on apps/reader → 200.
4. `SELECT 1` against the DB.
5. MinIO bucket `pdfs` exists.

If any fails, abort suite with a clear remediation message.

## Reporting

Suite must produce:

- A junit XML at `temp/e2e-1.3b-agents/reports/junit.xml`.
- A summary table: scenario | status | duration | notes.
- A list of skipped scenarios with reasons.
- Exit code 0 only if all non-skipped scenarios pass.

## Hand-off

The executing agent should:

1. Invoke `superpowers:test-driven-development` (RED-first, but the targets are existing system behavior — write tests, expect green; use the failures as defect reports).
2. Invoke `superpowers:using-git-worktrees` if running in a fresh worktree.
3. Read this README, `phase-1.3b-agents.md`, `phase-1.3-agent-platform.md` (master), and the `services/agents/docs/sse-event-matrix.md` contract before writing any test.
4. Audit pre-flight, report findings, decide which scenarios run live vs skip, then implement.
5. Commit per scenario with a clear name (`test(e2e): <scenario>`).
6. Final report: pass/fail counts, defects discovered (file as tech-debt entries in the gitignored `phase-1.3b-agents.md`).

## Defect filing

Any failure that is genuinely a bug in 1.3b (not test infrastructure) must:

1. Be reproduced with a minimal failing test that stays in the suite as `xfail` until fixed.
2. Be filed as a tech-debt entry §1.3b-E2E-N in `docs/superpowers/plans/phases/phase-1.3b-agents.md`.
3. Be reported in the final summary.

DO NOT silently fix code while running tests — this suite is verification, not implementation.

## What this suite does NOT prove

- Performance under load.
- Cost / token budgets.
- Multi-user concurrency.
- Failure modes beyond what's explicitly tested.
- Long-tail LLM behavior.
- Anything frontend (no UI exists).

These are out of scope for Phase 1.3b acceptance. They become 1.3c / 1.4 / pre-prod gates.
