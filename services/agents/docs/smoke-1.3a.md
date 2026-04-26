# Phase 1.3a Smoke Test Results

**Date:** 2026-04-26  
**Branch:** wt/1.3a-substrate  
**Model:** `openai/gpt-4o-mini` (via OpenRouter)  
**Sidecar:** `uvicorn main:app --port 8011`  
**PG URL:** `postgresql://episteme:episteme@localhost:5433/episteme`

---

## Lifespan boot log

```
INFO:main:AsyncPostgresSaver + AsyncPostgresStore opened for process lifetime
INFO:     Application startup complete.
```

---

## /invoke smoke

```
event: text
data: {"id": "019dcacd-dd54-7ee0-9150-9a58b40b8d92", "delta": "hello"}

event: text
data: {"id": "019dcacd-dd54-7ee0-9150-9a58b40b8d92", "delta": " world"}

event: done
data: {"thread_id": "smoke-1"}
```

**Observed event names:** `text`, `done`  
**Note:** No tool calls triggered for this simple prompt — `tool_call` / `tool_result` / `interrupt` not seen in this run (matrix correct, just not exercised here).

---

## /state smoke (after invoke)

```json
{"todos": [], "pending_interrupts": []}
```

Shape matches spec. `todos` comes from `checkpoint["channel_values"]["todos"]`. No todos set by this agent turn (write_todos not called).

---

## /resume smoke (no pending interrupt)

```
event: done
data: {"thread_id": "smoke-1"}
```

Correct — `Command(resume=decisions)` passed to `astream_events`, no interrupt pending so completes immediately with `done`.

---

## /config smoke

```json
{"ok": true}
```

Round-trip confirmed: POST with `{"modelPreference": "openai/gpt-4o-mini", "approvalRules": {"publish": "auto"}}` returns `{"ok": true}`.

---

## astream_events v2 event names observed

| Observed event name | Mapped to SSE type | Matrix entry |
|---------------------|--------------------|--------------|
| `on_chat_model_stream` | `text` | ✓ matches |

Events `on_tool_start` → `tool_call`, `on_tool_end` → `tool_result`, `on_chain_end` (with `__interrupt__`) → `interrupt` were not triggered by the smoke prompt but the mapping is verified by unit tests with mock events.

**No drift detected** between `_map_event` implementation and matrix v1.

---

## Bugs fixed

### Bug 1 — Async PostgresSaver/Store
- **Was:** `PostgresSaver` (sync) used with `astream_events` → `NotImplementedError: aget_tuple`
- **Fix:** `main.py` lifespan now uses `async with AsyncPostgresSaver.from_conn_string(url)` and `async with AsyncPostgresStore.from_conn_string(url)`. `checkpointer.py` and `store.py` removed sync fallback path; `get_saver()` / `get_store()` return cached async instance or `MemorySaver` / `InMemoryStore`.

### Bug 2 — Empty error SSE event
- **Was:** `except Exception as e: yield format_sse("error", {"message": str(e)})` — `str(NotImplementedError())` is `""`.
- **Fix:** Dropped `error` SSE event entirely (not in v1 matrix). Exceptions propagate, FastAPI returns 500 + traceback in dev. Test updated from asserting `event: error` to asserting `event: error` is NOT present.

### Bug 3 — `/state` built full agent (model + saver)
- **Was:** Called `build_km_agent(...)` then `agent.get_state(...)` — required LLM key for a read-only operation.
- **Fix:** Route calls `get_saver().aget_tuple(config)` directly. Extracts `todos` from `checkpoint["channel_values"]["todos"]`. `pending_interrupts` returns `[]` (deferred to 1.3b).

### Bug 4 — RETRACTED — gemma-4-31b-it:free DOES support tool calling
- Earlier note claimed the model didn't exist or didn't support tools. **Wrong.** Verified via OpenRouter `/api/v1/models`:
  - `id: google/gemma-4-31b-it:free`
  - `supported_parameters: [..., 'tool_choice', 'tools', ...]`
  - `pricing: {prompt: 0, completion: 0}` (free)
  - `context_length: 262144`
- **Real failure mode observed during smoke:** upstream rate limit (HTTP 429 from Google AI Studio: `"google/gemma-4-31b-it:free is temporarily rate-limited upstream"`). The free tier has shared quota — production needs a paid fallback OR per-user BYOK.
- **Default reverted to `google/gemma-4-31b-it:free`** in `lib/config_cache.py`.
- **Tech debt:** rate-limit handling — when 429 hits the SSE stream, surface a typed `error`/`rate_limited` event AND optionally cascade to a fallback paid model. Owner: 1.3c (BYOK + cascade UI per master spec §C).

---

## Test results

```
7 failed (pre-existing PDF fixture: test.pdf missing), 214 passed
```

All new tests GREEN. Pre-existing 7 failures unchanged.
