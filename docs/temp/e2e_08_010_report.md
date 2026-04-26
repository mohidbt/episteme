# E2E Test Report — Phases 0.8 / 0.9 / 0.10

**Date:** 2026-04-23  
**Tester:** Claude (automated via Chrome DevTools MCP)  
**Environment:** KM on localhost:3001, Agents on localhost:8000, DB on localhost:5433

---

## Phase 0.8 — Version History

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1.1 | Open Version drawer | **PASS** | Drawer rendered with "Versions" heading, "Save version" button |
| 1.2 | Initial revision (autosave) | **PASS** | Shows "autosave" revision with ~510 chars |
| 1.3 | Manual revision after save | **PASS** | "Save version" creates `manual` reason revision, 510 chars |
| 1.4 | Autosave after content edit | **PASS** | Editing content → wait → new `autosave` revision appears with updated char count |
| 1.5 | Diff view (manual vs autosave) | **PASS** | DiffView renders; added words green, removed red; shows word-level diff |
| 1.6 | Restore from older revision | **PASS** | Clicking older revision loads its content in editor |
| 1.7 | Console check | **PASS** | Zero red errors across all 0.8 steps |

## Phase 0.9 — AI Agent Integration

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 2.1 | AI chat panel opens | **PASS** | "Ask my notes" button → dialog with input |
| 2.2 | First question returns sourced answer | **PASS** | "What do I know about transformers?" → full answer with `[[E2E-transformers]]` link |
| 2.3 | Sources rendered as clickable links | **PASS** | `[[E2E-transformers]]` rendered as `<a>` linking to `/n/e2e-transformers` |
| 2.4 | SSE streaming (tokens arrive incrementally) | **PASS** | Network shows SSE `text/event-stream` response; tokens streamed progressively |
| 2.5 | Summarize note | **PASS** | Click Summarize → AI panel with summary content |
| 2.6 | `/ai` slash command in editor | **BUG** | ProseMirror intercepts Enter before `onKeyDown` on `host` div fires. API works (verified via `fetch`), but UI trigger is broken. **Regression bug.** |
| 2.7 | Embedding retrieval (relevant sources) | **PASS** | Chat response lists 4 source links: E2E-transformers, E2E-0.9-ai-slash, E2E-gradient-descent, E2E-pasta-recipes |
| 2.8 | Follow-up history preserved | **PASS** | Second POST body includes `history` array with prior Q&A pairs |
| 2.9 | Empty retrieval guard | **PASS** | "What did I write about quantum tunneling?" → "The sources provided do not contain any information about quantum tunneling." No hallucination. |
| 2.10 | Abort on close | **PASS** | Closing panel mid-stream → `net::ERR_ABORTED` on in-flight request. No console errors. |
| 2.11 | Console check | **PASS** | Zero red errors across all 0.9 steps |

## Phase 0.10 — Publishing

**SKIPPED** — `EPISTEME_PUBLISH_DOMAIN` not configured, no `/etc/hosts` entries set up. Per user instruction, all publish-dependent tests deferred.

## Cross-phase Regression

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| R1 | Sidebar navigation | **PASS** | 5 note links render, click navigates correctly |
| R2 | Editor content editable | **PASS** | `contentEditable="true"`, text present |
| R3 | Version drawer opens | **PASS** | Shows autosave + manual revisions |
| R4 | AI chat panel opens | **PASS** | Dialog + input present |
| R5 | Console errors | **PASS** | Zero red errors after all phases |

---

## Bugs Found

### BUG-1: `/ai` slash command not triggering (Phase 0.9 §2.6)

**Severity:** Medium (feature broken in UI, API works)  
**Root cause:** ProseMirror's internal Enter handler calls `preventDefault()` before event bubbles to `host` div where `onKeyDown` is registered. The `onKeyDown` handler at `NoteEditor.tsx:196` never receives Enter keypresses.  
**File:** `apps/km/src/app/(app)/n/[slug]/NoteEditor.tsx` line ~196  
**Workaround verified:** Direct `fetch` to `/api/ai/chat` works correctly — issue is purely in UI event propagation.  
**Fix direction:** Move `/ai` handler into a ProseMirror `handleKeyDown` plugin or use `capture` phase on the editor host.

---

## Summary

| Phase | Tests | Pass | Fail | Skip |
|-------|-------|------|------|------|
| 0.8 Version History | 7 | 7 | 0 | 0 |
| 0.9 AI Integration | 11 | 10 | 1 | 0 |
| 0.10 Publishing | — | — | — | — (deferred) |
| Regression | 5 | 5 | 0 | 0 |
| **Total** | **23** | **22** | **1** | **—** |