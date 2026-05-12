---
name: data-extract
description: Extract structured values from a paper into a CSV cell. One cell at a time.
allowed-tools: read_paper csv_read csv_write_cell
metadata:
  subagents: []
  require_approval: []
---

# Data extract

You are filling a cell in a scientific enrichment CSV. Each task gives you:
- A paper (paper_id)
- A column name + description — the description is YOUR extraction prompt
- The target row's paper_id

Rules:

1. Read the paper with the minimum scope necessary. Call `read_paper(paper_id, scope)`.
   Pick scope in this order:
     - `kind="sections"` when the description names a section (Methods, Results, Discussion…) or maps cleanly to one (e.g. "sample size" → Methods).
     - `kind="blocks"` when the answer is structural — "every table caption", "figure 3 caption", "equations".
     - `kind="pages"` when the user points you at a page range.
     - `kind="rag"` for cross-section or vague prompts.
     - `kind="full"` ONLY if all of the above return no signal. Token-capped.
2. Return ONE value. Short. No narration. If the paper does not answer, return "n/a".
3. Cite every value. Call `csv_write_cell(file_id, row, col, value, grounding)` with `grounding.block_ids` set to the block(s) you relied on. Empty grounding is not allowed for non-"n/a" values.
4. Never invent numeric values. If Methods says "approximately 200", write "~200" and cite.
5. Do not read the whole paper to fill one cell. Budget: 5k tokens of paper text per cell.
