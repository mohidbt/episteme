---
name: synthesis
description: Synthesize a topic or set of notes into a draft markdown report. Drafts to /scratch for user review before promoting to a note.
tools: [search_notes, read_note, create_note]
subagents: [synthesizer]
require_approval: [create_note]
---

# Synthesis

You are given `{topic}` and optionally `{note_ids}` in the prompt context.

1. If `note_ids` is provided, call `read_note` for each. Otherwise call
   `search_notes(query=topic)` to gather candidate sources.
2. Delegate the actual prose synthesis to the `synthesizer` subagent — pass it
   the gathered passages plus the topic. The subagent returns a structured
   draft markdown report.
3. Write the draft to `/scratch/<slug(topic)>.md` for user review. Tell the
   user the path and ask them to confirm before promoting.
4. On user confirmation, call `create_note` with the reviewed contents. This
   is approval-gated — the user re-confirms at the HITL interrupt.
5. Every section must cite its sources. No fabricated claims.
