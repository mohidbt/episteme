# SSE Event Matrix — v1 (locked 1.3a)

**Status:** LOCKED — this document is the binding contract between phases 1.3a, 1.3b, and 1.3c.

Do not add, rename, or remove event types without bumping the version (see [Versioning](#versioning))
and updating both the Python TypedDicts (`services/agents/lib/sse_events.py`) and the TypeScript
discriminated union (`apps/km/src/lib/agent-events.ts`) in the same commit.

---

## Event Matrix

| # | `type`       | Source / trigger                            | Payload fields                                                                                      | Emit owner  | Frontend AI Element consumer (1.3c) |
|---|--------------|---------------------------------------------|-----------------------------------------------------------------------------------------------------|-------------|--------------------------------------|
| 1 | `text`       | `astream_events` v2 `on_chat_model_stream`  | `id: string`, `delta: string`                                                                       | 1.3a        | `TextStreamCard` — accumulates deltas into prose |
| 2 | `thinking`   | `astream_events` v2 `on_chat_model_stream` (reasoning tokens) | `id: string`, `step_id?: string`, `delta: string`                             | 1.3b        | `ThinkingCard` — collapsible reasoning block |
| 3 | `tool_call`  | `astream_events` v2 `on_tool_start`         | `id: string`, `name: string`, `args: Record<string, unknown>`, `state: "input-available"`           | 1.3a        | `ToolCallCard` — shows tool name + args, pending state |
| 4 | `tool_result`| `astream_events` v2 `on_tool_end`           | `id: string`, `output?: unknown`, `errorText?: string`, `state: "output-available" \| "output-error"` | 1.3a      | `ToolCallCard` — updates matching card with output/error |
| 5 | `interrupt`  | `on_chain_end` `__interrupt__` value        | `id: string`, `tool: string`, `args: Record<string, unknown>`, `allowed_decisions: string[]`        | 1.3a        | `InterruptCard` — approve/reject buttons |
| 6 | `todos`      | State-update after `write_todos` tool       | `items: Array<{id: string, content: string, status: "pending" \| "in_progress" \| "completed"}>`   | 1.3b        | `TodosPanel` — sidebar list, live updates |
| 7 | `sources`    | `on_retriever_end` (deduplicated per turn)  | `message_id: string`, `citations: Citation[]`                                                       | 1.3b        | `SourcesCard` — citation list below assistant message |
| 8 | `skill_load` | Custom emit on skill activation             | `name: string`                                                                                      | 1.3b        | `SkillBadge` — transient toast in chat |
| 9 | `file_diff`  | Custom emit on note write (Next.js side)    | `note_id: string`, `before_hash: string`, `after_hash: string`, `diff: string`                      | 1.3c        | `FileDiffCard` — inline diff viewer |
|10 | `suggestion` | Post-`done` opt-in emit                     | `items: string[]`                                                                                   | 1.3b        | `SuggestionChips` — follow-up prompt chips |
|11 | `done`       | End of `astream_events` iteration           | `thread_id: string`                                                                                 | 1.3a        | Stream termination — flush pending cards |

### Citation schema

```
Citation {
  chunk_id: string      // required — stable retrieval chunk ID
  title?:   string      // document title
  url?:     string      // source URL or note path
  page?:    number      // page number for PDF sources
}
```

---

## Payload field types (canonical)

### `text`
```
id:    string   — run_id from astream_events
delta: string   — incremental token chunk (never empty)
```

### `thinking`
```
id:      string   — run_id
step_id: string?  — step identifier for multi-step reasoning (optional)
delta:   string   — incremental reasoning token
```

### `tool_call`
```
id:    string                    — run_id (matches paired tool_result.id)
name:  string                    — tool function name
args:  Record<string, unknown>   — input arguments dict
state: "input-available"         — always this value on emission
```

### `tool_result`
```
id:        string                           — matches originating tool_call.id
output:    unknown?                         — tool output (omitted on error)
errorText: string?                          — error message (omitted on success)
state:     "output-available" | "output-error"
```

### `interrupt`
```
id:                string                  — interrupt ID (matches pending tool_call_id)
tool:              string                  — tool that raised the interrupt
args:              Record<string, unknown> — args the tool was called with
allowed_decisions: string[]               — e.g. ["approve", "reject"]
```

### `todos`
```
items: Array<{
  id:      string
  content: string
  status:  "pending" | "in_progress" | "completed"
}>
```

### `sources`
```
message_id: string      — associates citations with a specific assistant message
citations:  Citation[]  — deduplicated for this turn
```

### `skill_load`
```
name: string   — skill identifier (e.g. "rag-search", "calculator")
```

### `file_diff`
```
note_id:     string   — UUID of the note modified
before_hash: string   — SHA of content before write
after_hash:  string   — SHA of content after write
diff:        string   — unified diff string
```

### `suggestion`
```
items: string[]   — list of follow-up prompt suggestions
```

### `done`
```
thread_id: string   — LangGraph thread ID for the completed stream
```

---

## Stable IDs

Every event carries an `id: string` field (except `todos`, `suggestion`, and `done` which
are turn-level singletons and carry `thread_id` / `message_id` instead).

ID generation rules:

| Event          | ID value                                                          |
|----------------|-------------------------------------------------------------------|
| `text`         | `run_id` from `astream_events` — accumulate deltas from same ID  |
| `thinking`     | `run_id` — same accumulation pattern as `text`                   |
| `tool_call`    | `run_id` at `on_tool_start`                                       |
| `tool_result`  | Same `run_id` as the paired `tool_call` — enables card update     |
| `interrupt`    | Interrupt object's own ID; matches the pending `tool_call_id`     |

Frontend consumers MUST key rendered cards on `id` so that a `tool_result` can update
the matching `tool_call` card without creating a duplicate.

---

## Emit Ownership

### 1.3a — substrate (current)
Emitters implemented and smoke-tested in `services/agents/routers/km_agent.py`:
- `text` — `on_chat_model_stream` delta extraction
- `tool_call` — `on_tool_start`
- `tool_result` — `on_tool_end` (output-available + output-error)
- `interrupt` — `on_chain_end` `__interrupt__` value
- `done` — end of `astream_events` loop

### 1.3b — skill-driven emitters
Emitters to be added in the 1.3b phase:
- `thinking` — reasoning-token stream from compatible models
- `todos` — state-update hook after `write_todos` tool execution
- `sources` — `on_retriever_end` with per-turn deduplication
- `skill_load` — custom emit on skill activation in skill runner
- `suggestion` — post-`done` opt-in via agent config flag

### 1.3c — Next.js side
- `file_diff` — emitted by the Next.js route handler after a note write completes;
  bridges the Python agent stream with the editor's document state.

---

## Versioning

The matrix version is embedded in this document header and in the `format_typed` implementation.
Current version: **v1** (locked at end of 1.3a).

When changing the matrix:
1. Bump version (e.g. `v1` → `v2`) in this document.
2. Update Python TypedDicts in `services/agents/lib/sse_events.py`.
3. Update TypeScript union in `apps/km/src/lib/agent-events.ts`.
4. Update `_REQUIRED_KEYS` in `sse_events.py` to match.
5. Add/update tests in `test_sse_events_matrix.py` and `agent-events.test.ts`.
6. Reference the new version in the PR description so 1.3b/1.3c implementors know to rebase.

Breaking changes (renaming a field, removing an event type) require a major version bump and
coordination across all active worktrees.
