# Episteme: AI-Native Obsidian + Zotero + Acrobat for Research

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Research management software** built for the agentic era. Papers, references, highlights, notes, and reading in one workspace. One context layer. Deepagents with full CRUD baked in.

> *"I have 47 tabs open, 12 PDFs in Acrobat, half my highlights in Zotero, the other half scribbled in Obsidian, and ChatGPT doesn't know about any of it."*

You're writing methods and need that one detail from a paper you skimmed weeks ago. Not in Zotero. Not in Obsidian. Maybe Downloads? Eventually you just re-read the damn thing, and the connection you'd made to two other papers on Tuesday is long gone.

Researchers today live in a duct-taped stack:

|  | Obsidian | Zotero | Acrobat | ChatGPT | AI PDF Readers | **Episteme** |
|---|---|---|---|---|---|---|
| Notes & ideas | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| References | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| PDF reader + highlights | ❌ | ⚠️ | ✅ | ❌ | ✅ | ✅ |
| Agents with full CRUD | ❌ | ❌ | ❌ | ⚠️ chatbot only | ⚠️ chatbot only | ✅ |
| Unified context | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

Most "AI for research" tools are RAG chatbots stuck answering questions. Episteme gives agents tools, so they *do* the work across your whole knowledge graph.

---

### What this unlocks

The point isn't tool consolidation. It's that **unified context = agents that can actually help**.

* **Academic story**: trace any claim in your notes back through papers, references, and citation chains.
* **Reverse highlight**: add a new paper, agent auto-highlights every line that touches your prior claims. Reading becomes diffing against your worldview.
* **Agentic distillation**: 50 papers to skim for methodology? Don't ask a chatbot 50 times. Spin up 50 subagents, get a table.
* **Research handovers**: hand the whole library to the next PhD. Done.

> *Long-term bet: once models can write papers, the moat is whose context they're grounded in. We want that context to live in Episteme.*

---

### Stack

* **Heart** ❤️: (LangChain) Deepagents, FastAPI, Python.
* **Body** 🕺🏻: Next.js, TypeScript, Tailwind, Drizzle.
* **Makeup** 💄: Tiptap (notes), Yjs (collab), react-pdf (reader).
* **Costume** 🥋: Vercel + Fluid Compute, Cloudflare R2 for files.

---

### Status

Alpha shipped. Onboarding PhDs in biochem / biophys daily. Beta next.

Try it at [app.tryepisteme.com](https://app.tryepisteme.com). Landing at [tryepisteme.com](https://tryepisteme.com).

---

### Repo layout

```
apps/        # km (workspace), reader, marketing
packages/    # editor, reader, ui, shared libs
services/    # agents (FastAPI + deepagents)
docs/        # PRD, plans, specs
```

---

### Contributing

Early days. If you're a researcher who wants a sane stack, ping me. If you're an engineer who likes local-first + agents + document infra, also ping me.

[MIT License](LICENSE)
