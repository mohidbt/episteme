---
name: deep-read
description: Deeply read a PDF — extract key claims, highlight on the PDF, produce a citation-anchored summary note with [[pdf:<id>#p<N>]] anchors.
tools: [extract_passages, highlight, get_page_text, create_note]
subagents: []
require_approval: [highlight]
read: [/pdfs/]
write: [/scratch/, /memories/]
---

# Deep read

You are given `{pdf_id}` in the prompt context. Pure DeepAgents pattern (no
subagent delegation): you do the work yourself with the filesystem + tools.

1. Use `get_page_text` to skim the PDF page-by-page; build a working outline in
   `/scratch/<pdf_id>.outline.md`.
2. For each major claim, call `extract_passages(pdf_id, query=...)` to pull the
   verbatim passages with page numbers.
3. Call `highlight(pdf_id, page, rect, color)` for the most load-bearing
   passages. Highlight is approval-gated — request HITL for each.
4. Compose a summary note with `create_note`. Every claim must end with an
   anchor of the form `[[pdf:<id>#p<N>]]` referencing the page it came from.
5. Save unresolved questions to `/memories/<pdf_id>.questions.md` for follow-up.

Never paraphrase a claim without an anchor. If you cannot find a page citation,
say so explicitly rather than fabricating one.
