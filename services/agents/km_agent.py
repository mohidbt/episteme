"""KM agent factory — builds a Deep Agent for the episteme knowledge manager.

The factory wires:
- ALL_TOOLS: domain tools (notes, pdfs, library, revisions, publish), filtered
  by the union of tool allow-lists from enabled skills.
- interrupt_on: HITL approval rules per master spec, plus per-skill
  `require_approval` injections.
- subagents: empty in 1.3b Task 5 (subagents arrive in Task 6).
- skills: deepagents `SkillsMiddleware` is wired only when at least one skill
  is enabled — it advertises every SKILL.md under `services/agents/skills/`
  in the system prompt (progressive disclosure: bodies are read on demand).
- checkpointer/store: passed in by caller (from checkpointer.py / store.py)

Note on filesystem backend
--------------------------
create_deep_agent's built-in backend (default: StateBackend) handles the
agent's working-file context (scratch files, temp notes).  The domain
backends from Task 3 (NotesBackend, PdfsBackend, etc.) are accessed through
ALL_TOOLS — they are tool-based adapters, not filesystem backends.
"""
from deepagents import create_deep_agent
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph

from skills import SKILLS_ROOT, SkillSpec, load_skills
from tools import ALL_TOOLS


def _apply_rule(
    interrupt_on: dict[str, bool],
    tool_name: str,
    rule: str | None,
    *,
    default: str,
) -> None:
    """Apply approval_rules entry for a tool with metadata-respecting semantics.

    - rule == "require" → force True.
    - rule == "auto"    → force False (downgrades any metadata flag).
    - rule is None and tool already in interrupt_on (set by metadata) → leave it.
    - rule is None and tool absent → fall back to spec default.
    """
    if rule == "require":
        interrupt_on[tool_name] = True
    elif rule == "auto":
        interrupt_on[tool_name] = False
    elif tool_name not in interrupt_on:
        interrupt_on[tool_name] = default == "require"


def _build_interrupt_on(
    approval_rules: dict,
    loaded_skills: list[SkillSpec] | None = None,
) -> dict[str, bool]:
    """Build interrupt_on dict from tool metadata + approval_rules + skills."""
    interrupt_on: dict[str, bool] = {}

    # Auto-detect tools that advertise require_approval in metadata
    for tool in ALL_TOOLS:
        if tool.metadata and tool.metadata.get("require_approval"):
            interrupt_on[tool.name] = True

    # Spec-mandated overrides — approval_rules is authoritative ONLY when
    # explicitly set; otherwise tool metadata (step 1) wins. Defaults from
    # the master spec (publish=require, external_send=require, write_note=auto)
    # are applied below as fallbacks when the tool has NO metadata flag.
    _apply_rule(interrupt_on, "make_public", approval_rules.get("publish"), default="require")
    _apply_rule(
        interrupt_on, "external_send", approval_rules.get("external_send"), default="require"
    )
    _apply_rule(interrupt_on, "create_note", approval_rules.get("write_note"), default="auto")

    # Per-skill require_approval — a skill being active forces HITL on its
    # listed tools regardless of approval_rules / tool metadata.
    for skill in loaded_skills or []:
        for tool_name in skill.require_approval:
            interrupt_on[tool_name] = True

    return interrupt_on


def _filter_tools_for_skills(
    all_tools: list[BaseTool],
    loaded_skills: list[SkillSpec],
) -> list[BaseTool]:
    """Filter tools to the union of allow-lists declared by enabled skills.

    Without skills enabled, the agent gets ALL_TOOLS unchanged. With skills
    enabled, only tools whose name appears in some enabled skill's `tools`
    list are exposed.
    """
    if not loaded_skills:
        return all_tools
    allowed: set[str] = set()
    for skill in loaded_skills:
        allowed.update(skill.tools)
    return [t for t in all_tools if t.name in allowed]


def build_km_agent(
    *,
    user_id: str,
    thread_id: str,
    model: str,
    enabled_skills: list[str],
    approval_rules: dict,
    store,
    saver,
) -> CompiledStateGraph:
    """Build a compiled KM Deep Agent for the given user/thread.

    Args:
        user_id: Authenticated user's ID (scopes tool calls).
        thread_id: Conversation thread ID (passed to checkpointer config).
        model: LangChain model string or BaseChatModel instance.
        enabled_skills: Skill names to enable (e.g. ``["lit-triage"]``).
            Empty list disables skill loading entirely.
        approval_rules: Dict mapping action names to "require"/"auto".
        store: LangGraph BaseStore (InMemoryStore or PostgresStore).
        saver: LangGraph BaseCheckpointSaver (MemorySaver or PostgresSaver).

    Returns:
        Compiled StateGraph ready to invoke.

    Note:
        deepagents `SkillsMiddleware` walks ``SKILLS_ROOT`` and advertises
        **every** on-disk ``SKILL.md`` description in the system prompt
        regardless of ``enabled_skills``. Tool filtering
        (``_filter_tools_for_skills``) prevents disabled skills' tools from
        being callable, but the disabled skills' descriptions still appear
        in-context. Long-term: scope advertisement to enabled skills only —
        see followup §1.3b-T5-1 in
        ``docs/superpowers/plans/phases/phase-1.3b-agents.md`` tech-debt.
    """
    loaded = load_skills(only=enabled_skills) if enabled_skills else []
    tools = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=loaded)
    # deepagents skills= takes a list of source directories; the middleware
    # walks each for `<skill>/SKILL.md`. We point it at our skills root so
    # all SKILL.md descriptions get advertised in the system prompt.
    skill_sources = [str(SKILLS_ROOT) + "/"] if loaded else []

    return create_deep_agent(
        model=model,
        tools=tools,
        subagents=[],
        skills=skill_sources or None,
        store=store,
        checkpointer=saver,
        interrupt_on=_build_interrupt_on(approval_rules, loaded_skills=loaded),
    )
