# Episteme: AI-Native Obsidian + Zotero + Acrobat for Research

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Research management software** for people who actually want to use agents on their work. Papers, references, highlights, notes, and reading in one workspace, with deepagents that can read and write all of it.

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

Most "AI for research" tools are RAG chatbots that answer questions about your stuff. Episteme gives the agents tools, so they can also change your stuff: write notes, link references, highlight PDFs, file papers.

---

### What this unlocks

Consolidating tools is fine, but it's not really the point. The point is that once everything lives in one graph, the agent has enough context to do something useful with it.

* **Academic story**: trace any claim in your notes back through the papers, references, and citation chains it came from.
* **Reverse highlight**: drop in a new paper, the agent highlights every line that touches something you've already written. Reading turns into diffing against your own worldview.
* **Agentic distillation**: got 50 papers to skim for methodology? Don't ask a chatbot 50 times. Fan out 50 subagents and get a table back.
* **Research handovers**: hand the whole library to the next PhD and be done with it.

> *Long-term bet: once models can write papers on their own, the thing that matters is whose context they're grounded in. I want that context to live in Episteme.*

---

### Stack

* **Heart** ❤️: (LangChain) Deepagents, FastAPI, Python.
* **Body** 🕺🏻: Next.js, TypeScript, Tailwind, Drizzle.
* **Makeup** 💄: Tiptap (notes), Yjs (collab), react-pdf (reader).
* **Costume** 🥋: Vercel + Fluid Compute, Cloudflare R2 for files.

---

### Status

Alpha is out. Onboarding PhDs one at a time. Beta after that.

App: [app.tryepisteme.com](https://app.tryepisteme.com). Landing: [tryepisteme.com](https://tryepisteme.com).

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

Early days. If you're a researcher who wants a saner stack, ping me. Same if you're an engineer who likes local-first, agents, or document infra.

[MIT License](LICENSE)
