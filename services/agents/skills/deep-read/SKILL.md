---
name: deep-read
description: Deeply read a PDF — produce a citation-anchored summary with [[pdf:<id>#p<N>]] anchors.
tools: [read_paper, pdf_read_text, pdf_explain_passage, search_pdfs, search_library, highlight, create_note]
subagents: []
require_approval: [highlight]
read: []
write: [/.episteme/agents/memories/, /scratch/]
---

You are given `{pdf_id}` (or, if not, search for the paper with `search_pdfs`).

1. Read the paper:
   - For full-document or multi-page text, call `read_paper(paper_id=<pdf_id>, scope={"kind": "full"})` or `scope={"kind": "pages", "range": [lo, hi]}`.
   - For a single page, call `pdf_read_text(paper_id=<pdf_id>, page=N)`.
   - For a passage selected by the user (reader UX), call `pdf_explain_passage(paper_id=<pdf_id>, page=N, text="...")`.
   Build a working outline in `/scratch/<pdf_id>.outline.md`.
2. For each major claim, cite the page using `[[pdf:<pdf_id>#p<N>]]`.
3. For benchmarks / results / tables, call `read_paper(paper_id=<pdf_id>, scope={"kind": "blocks", "types": ["table"]})`.
4. For structured extraction (e.g. doses, hyperparameters), call `read_paper` over the relevant scope and have the LLM extract structured fields directly. (`pdf_extract_data` is no longer wired to a backend.)
5. To bring in cross-library context (related notes, other papers cited by the user), call `search_library(query=...)`.
6. Highlight the most load-bearing passages — `highlight` is HITL-gated.
7. Write the final summary with `create_note`. Every claim must end in an anchor. If you can't find a page citation, say so explicitly — never fabricate.
8. Save unresolved questions to `/.episteme/agents/memories/<pdf_id>.questions.md`.
