# Framework Selection — Deep Agents Substrate

**Decision Date:** 2026-04-26  
**Framework:** Deep Agents (on LangGraph, on LangChain)  
**Status:** Adopted

---

## Decision Matrix (6/6 → Deep Agents)

### 1. Long-running, multi-step, editable plan → needs planning loop

The agent must break research tasks into measurable sub-steps, track progress, allow the user to edit the plan mid-session, and adapt to new findings. A simple tool loop cannot expose this state to the user for modification. **Deep Agents' `TodoListMiddleware`** provides built-in plan tracking with the `write_todos` tool, letting the agent create and revise a task list as research evolves.

### 2. Notes + PDFs behave like a filesystem the agent mutates → needs filesystem middleware

The research agent reads and writes notes, annotates PDFs, moves artifacts between collections, and manages versions. This is fundamentally a filesystem abstraction (even if backed by a database). **Deep Agents' `FilesystemMiddleware`** provides `ls`, `read_file`, `write_file`, `edit_file`, `glob`, and `grep` tools out of the box, modeling the knowledge base as a navigable tree that the agent can inspect and modify.

### 3. Literature triage / synthesis / verifier are independent specialists with conflicting system prompts → needs subagents

The agent system includes three specialized sub-agents:
- **Triage:** Classify and filter literature quickly.
- **Synthesis:** Aggregate findings into coherent narratives.
- **Verifier:** Cross-check claims against source material (retry-until-supported loop).

Each has its own system prompt and optimization. Rather than merging them into one monolithic prompt, **Deep Agents' `SubAgentMiddleware`** lets us delegate work to named subagents via the `task` tool, keeping each specialist focused and testable.

### 4. Agent count will grow (8 planned, more possible) — context budget forbids all instructions always-loaded → needs on-demand skills

Each agent type (and user domain variant) will have its own skill library — domain-specific tools, RAG retrieval instructions, and domain prompts. Loading all 8+ agents' instructions into every invocation is infeasible. **Deep Agents' `SkillsMiddleware`** loads SKILL.md files on demand, keeping context budget under control and allowing skills to be versioned and composed independently.

### 5. "Research interests / vocabulary / style" persist across sign-outs → needs cross-session memory

User preferences and learned vocabulary (e.g., "always cite via DOI, not URL") must survive session boundaries. The agent must reconstruct context from prior sessions without re-reading entire conversation histories. **Deep Agents' `MemoryMiddleware`** provides a `Store` interface for long-term memory, enabling the agent to query and update user context across sign-outs.

### 6. Publish / external send / bulk writes must be user-approved → needs HITL

Certain actions (publishing research, sending to external systems, bulk writes to the knowledge base) are irreversible and require human sign-off. The agent must pause before executing these and wait for approval. **Deep Agents' `HumanInTheLoopMiddleware`** intercepts sensitive tool calls and requests human approval before proceeding.

---

## Architecture

**Top level:** Deep Agents orchestrator (`create_deep_agent`), configured with:
- `TodoListMiddleware` (always on)
- `FilesystemMiddleware` (always on)
- `SubAgentMiddleware` (always on)
- `SkillsMiddleware` (opt-in, enabled)
- `MemoryMiddleware` (opt-in, enabled)
- `HumanInTheLoopMiddleware` (opt-in, enabled)

**Subagent layer:** Each subagent (triage, synthesis, verifier) is registered as a named `SubAgent`. The **verifier subagent** uses a LangGraph graph directly (implementing a retry-until-supported loop with explicit backoff), wrapped as a Deep Agents `SubAgent` — this pattern allows precise control over verification logic while keeping orchestration at the Deep Agents level.

**Foundation:** LangChain tools, models, and RAG pipelines are used freely inside all layers.

---

## Skill Consultation Log

The following `langchain-skills:*` skills were consulted during framework selection:

1. **`langchain-skills:framework-selection`** — Decision guide, framework profiles, middleware reference, mixing layers patterns.

---

## Outcome

All 6/6 decision points resolved in favor of Deep Agents. Implementation proceeding to Phase 1.3a substrate layer.
