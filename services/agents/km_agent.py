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
import logging

from deepagents import CompiledSubAgent, SubAgent, create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph
from langgraph.store.base import BaseStore

from skills import SKILLS_ROOT, SkillSpec, load_skills
from subagents import build_researcher, build_synthesizer, build_verifier
from tools import ALL_TOOLS

logger = logging.getLogger(__name__)


# System prompt addendum that teaches the model the memory contract.
# Without this, "Remember: my X is Y" prompts produce a friendly text reply
# but no `write_file` call, so nothing persists across threads. The wording
# is deliberately concrete: name the tool, name the path, give one example.
_MEMORY_SYSTEM_PROMPT = """## Memory

You have a persistent memory under `/memories/`. Anything you write there
survives across threads — use it to remember facts the user tells you about
themselves, their preferences, ongoing projects, or research interests.

When the user says "Remember: <fact>" (or similar — "make a note that…",
"keep in mind that…"), call the `write_file` tool with an absolute path
under `/memories/` and the fact as the file's content. Choose a short,
descriptive filename ending in `.md` (e.g. `/memories/research-interests.md`,
`/memories/writing-style.md`).

When a user asks something where prior memory might be relevant, read from
`/memories/` first (use `ls /memories/` or `read_file`) before answering."""


def _build_memory_backend(*, user_id: str, store: BaseStore) -> CompositeBackend:
    """Build the deepagents filesystem backend with /memories/ routed to the store.

    The agent's working files (scratch, temp notes) stay ephemeral in
    StateBackend. Anything under /memories/ is routed to the persistent
    StoreBackend so it survives across threads and process restarts.

    Namespace shape: ``("memories:<user_id>",)`` — a single component so the
    LangGraph PostgresStore stringifies the prefix as exactly
    ``memories:<user_id>`` (it joins with ``.``). The ``store`` table E2E
    query relies on that prefix to resolve cross-thread reads.
    """
    namespace = (f"memories:{user_id}",)
    return CompositeBackend(
        default=StateBackend(),
        routes={"/memories/": StoreBackend(store=store, namespace=lambda _rt: namespace)},
    )


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


# Tools the agent must always have access to, regardless of which skills are
# enabled. Skills curate ADDITIONAL skill-specific tools on top of these. Without
# the core, basic conversational asks ("list my notes", "show references")
# silently fail when any skill is toggled on.
_CORE_TOOL_NAMES: frozenset[str] = frozenset({
    "list_notes",
    "search_notes",
    "read_note",
    "create_note",
    "update_note",
    "list_links",
    "list_backlinks",
    "list_references",
    "get_reference",
})


def _filter_tools_for_skills(
    all_tools: list[BaseTool],
    loaded_skills: list[SkillSpec],
) -> list[BaseTool]:
    """Filter tools to CORE ∪ enabled-skills allowlists."""
    if not loaded_skills:
        return all_tools
    allowed: set[str] = set(_CORE_TOOL_NAMES)
    for skill in loaded_skills:
        allowed.update(skill.tools)
    return [t for t in all_tools if t.name in allowed]


def _select_subagents(
    loaded_skills: list[SkillSpec],
    *,
    available_tools: list[BaseTool] | None = None,
) -> list[SubAgent | CompiledSubAgent]:
    """Materialize the subagents referenced by the enabled skills' frontmatter.

    Each skill's `subagents:` array names which subagents that skill needs.
    The union of those names is constructed via the per-subagent factory so
    each gets its own filtered tool allow-list.

    `available_tools` defaults to `ALL_TOOLS` so the subagent factory can
    pick the BaseTool instances that match its declared name allow-list.
    """
    if not loaded_skills:
        return []
    wanted: list[str] = []
    seen: set[str] = set()
    for skill in loaded_skills:
        for name in skill.subagents:
            if name not in seen:
                seen.add(name)
                wanted.append(name)

    pool: list[BaseTool] = list(available_tools if available_tools is not None else ALL_TOOLS)

    builders = {
        "researcher": build_researcher,
        "synthesizer": build_synthesizer,
        "verifier": build_verifier,
    }
    # Build a name → owning-skill index so warnings can name the offender.
    name_to_skill: dict[str, str] = {}
    for skill in loaded_skills:
        for sub_name in skill.subagents:
            name_to_skill.setdefault(sub_name, skill.name)

    out: list[SubAgent | CompiledSubAgent] = []
    for name in wanted:
        builder = builders.get(name)
        if builder is None:
            # Unknown subagent name in a skill frontmatter — surface loudly so
            # misconfigured frontmatter is visible in logs (was previously
            # silent; see fix #6 / tech-debt §1.3b-T6-4).
            logger.warning(
                "skill %r references unknown subagent %r; ignoring",
                name_to_skill.get(name, "<unknown>"),
                name,
            )
            continue
        out.append(builder(available_tools=pool))
    return out


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

    subagents = _select_subagents(loaded, available_tools=tools)

    return create_deep_agent(
        model=model,
        tools=tools,
        subagents=subagents,
        skills=skill_sources or None,
        system_prompt=_MEMORY_SYSTEM_PROMPT,
        store=store,
        checkpointer=saver,
        backend=_build_memory_backend(user_id=user_id, store=store),
        interrupt_on=_build_interrupt_on(approval_rules, loaded_skills=loaded),
    )
