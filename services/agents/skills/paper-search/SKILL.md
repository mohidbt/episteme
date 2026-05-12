---
name: paper-search
description: "Use when the user asks to find, search, locate, or download a paper PDF for a reference. Call agentic_search_papers(reference_id) first — it searches Semantic Scholar (an EXTERNAL academic database, NOT the user's library) by DOI then by title/author/year and returns ranked candidates. Present candidate #1 to the user; on rejection present #2, etc. On approval call agentic_fetch_papers(reference_id, paper_url, metadata) to download the PDF and link it. Never use list_references or search_notes to find papers — always use agentic_search_papers. If the tool returns an error field, tell the user the search service is unavailable (not that the paper doesn't exist)."
allowed-tools: agentic_search_papers agentic_fetch_papers
metadata:
  subagents: []
  require_approval: [agentic_fetch_papers]
read: [references, papers]
write: [papers]
---

# Paper search

You are given a `{reference_id}` in the prompt context. Pure DeepAgents pattern
(no subagent delegation): you do the work yourself with the tools.

1. If the reference already has a linked paper, ask the user if they want to
   replace it before proceeding.
2. Call `agentic_search_papers(reference_id)` to find candidate matches.
3. If `found: false` with an `error` field, tell the user the Semantic Scholar search service is currently unavailable (not that the paper doesn't exist). Suggest trying again later.
4. If `found: false` with no `error` field (genuinely no results), suggest adding a DOI to the reference or correcting the title/authors/year.
   or correcting the title/authors/year.
4. If `found: true` with candidates:
   - Present candidate #1 with its `match_confidence` label (exact/high/medium),
     title, authors, year, venue, citation count, and abstract snippet.
   - If `match_confidence` is "exact" (DOI match), present only that one result.
   - Wait for user approval before proceeding.
5. If user approves: call `agentic_fetch_papers(reference_id, open_access_pdf_url,
   metadata)`. This is approval-gated — the user confirms the download at the
   HITL interrupt.
6. If user rejects the candidate: present the next candidate ("Here's the next
   match:").
7. After all candidates rejected: inform the user that no matching paper was
   found. Suggest adding a DOI to the reference or trying different search terms.
8. After successful fetch: inform the user the paper is saved and present an
   "Open Paper" suggestion card.

If `open_access_pdf_url` is null for a matched paper, inform the user that the
paper was found but no free PDF is available. Do not attempt to fetch.

Never skip user confirmation on a candidate match. Never fetch a paper the user
has not approved.