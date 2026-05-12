---
name: claim-verify
description: Given a note, finds each standalone claim and verifies it against the user's PDF library. Flags unsupported claims inline.
allowed-tools: read_note update_note list_references
metadata:
  subagents: [verifier]
  require_approval: [update_note]
---

# Claim verifier

1. `read_note(<note_id>)`.
2. Extract every declarative sentence that makes a factual claim (skip subjective sentences + questions).
3. For each claim: delegate to the `verifier` subagent with `{claim, candidate_sources: list_references()}`. The verifier's LangGraph loop searches notes + references and retries up to 3 times. (Direct passage-level PDF reads land in Phase 1.5.1; until then the verifier works from notes + reference metadata.)
4. Build an edited version of the note where each unsupported claim is prefixed with `⚠ [unsupported] ` (inline flag — author decides what to do with it).
5. `update_note` with the edited content. HITL will prompt before the write.

**Rule:** never auto-edit a supported claim. Only flag unsupported ones.
