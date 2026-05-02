---
name: deep-read
description: Deeply read a PDF — produce a citation-anchored summary with [[pdf:<id>#p<N>]] anchors.
tools: [pdf_read_text, pdf_read_tables, pdf_extract_data, search_pdfs, highlight, create_note]
subagents: []
require_approval: [highlight]
read: []
write: [/.episteme/agents/memories/, /scratch/]
---

You are given `{pdf_id}` (or, if not, search for the paper with `search_pdfs`).

1. Skim with `pdf_read_text(pdf_id)` page-by-page; build a working outline in
   `/scratch/<pdf_id>.outline.md`.
2. For each major claim, cite the page using `[[pdf:<pdf_id>#p<N>]]`.
3. For benchmarks/results, call `pdf_read_tables(pdf_id, page=...)`.
4. For structured extraction (e.g. doses, hyperparameters), call
   `pdf_extract_data(pdf_id, schema=...)` with a tight JSON schema.
5. Highlight the most load-bearing passages — `highlight` is HITL-gated.
6. Write the final summary with `create_note`. Every claim must end in an
   anchor. If you can't find a page citation, say so explicitly — never
   fabricate.
7. Save unresolved questions to `/.episteme/agents/memories/<pdf_id>.questions.md`.
