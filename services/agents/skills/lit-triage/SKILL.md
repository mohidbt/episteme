---
name: lit-triage
description: Daily arXiv/bioRxiv/PubMed triage filtered by the user's research interests. Writes an inbox note with "must read / skim / skip" buckets + one-line citations.
tools: [search_notes, list_references, create_note]
subagents: [researcher]
require_approval: [create_note]
---

# Literature triage

1. Read `/memories/research-interests.md` (if absent, politely ask the user to set it via Settings → Agents → Memory).
2. Delegate to `researcher` subagent with the interests as a query. Researcher has MCP access to arxiv/biorxiv/pubmed + web search.
3. For each hit: classify as **must-read / skim / skip** with 1-sentence rationale grounded in the abstract.
4. Write `create_note(title="Inbox — <today>", contentMd=<markdown bucket list>)`. The user's default library is used automatically; pass `library_id` only if you genuinely need to disambiguate (call `list_libraries` first).
5. Cite every claim with a link to the source. No unsourced paragraphs — ever.
