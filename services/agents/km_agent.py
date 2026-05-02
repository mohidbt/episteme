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
from deepagents.backends import CompositeBackend, StateBackend
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph
from langgraph.store.base import BaseStore

from lib.km_http import km_get
from skills import SkillSpec
from skills.drive_loader import DriveSkillsLoader
from subagents import build_researcher, build_synthesizer, build_verifier
from tools import ALL_TOOLS

logger = logging.getLogger(__name__)


async def _fetch_personal_skills(user_id: str) -> list[dict]:
    """Fetch user-authored personal skills from the KM API.

    Returns a list of {slug, name, description, instructions} dicts.
    On failure returns [] (non-fatal — personal skills are best-effort).
    """
    try:
        resp = await km_get("/api/agents/skills/personal", user_id=user_id)
        if isinstance(resp, dict) and isinstance(resp.get("skills"), list):
            return [s for s in resp["skills"] if isinstance(s, dict)]
    except Exception:  # noqa: BLE001
        logger.warning("personal skills fetch failed for user %s", user_id)
    return []


# System prompt addendum that teaches the model the memory contract.
# Without this, "Remember: my X is Y" prompts produce a friendly text reply
# but no `write_file` call, so nothing persists across threads. The wording
# is deliberately concrete: name the tool, name the path, give one example.
_MEMORY_SYSTEM_PROMPT = """## Memory

You have a persistent memory under `/.episteme/agents/memories/`. Anything you
write there survives across threads — use it to remember facts the user tells
you about themselves, their preferences, ongoing projects, or research
interests. These memories live as real notes in the user's drive (under the
`.episteme/agents/memories` folder), so they ride along with library exports
and the user can edit them directly.

When the user says "Remember: <fact>" (or similar — "make a note that…",
"keep in mind that…"), call the `write_file` tool with an absolute path under
`/.episteme/agents/memories/` and the fact as the file's content. Choose a
short, descriptive filename ending in `.md` (e.g.
`/.episteme/agents/memories/research-interests.md`,
`/.episteme/agents/memories/writing-style.md`). For sub-topics, organize
into subfolders (e.g. `/.episteme/agents/memories/research/transformers.md`).

When a user asks something where prior memory might be relevant, read from
`/.episteme/agents/memories/` first (use `ls` or `read_file`) before
answering.

## Filesystem tool scope (STRICT)

The filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`,
`grep`) operate ONLY on the agent state filesystem. The ONLY paths these
tools can see are:

- `/.episteme/agents/memories/**` — your persistent memories (read+write).
- `/.episteme/agents/skills/**`   — skill definitions (read-only; do not
  write here unless the user explicitly asks to author a new skill).
- `/<scratch>.md`                 — ephemeral per-turn scratch (lost after
  the thread).

**These tools DO NOT see the user's drive content.** Notes, PDFs, papers,
references, and library files are NOT on this filesystem. Calling
`glob("**/*.pdf")` or `ls("/")` will NEVER return drive content — it will
return an empty list (or only your memories/skills) and waste a turn.

To work with drive content, use the dedicated tools (list_notes, search_notes,
read_note, create_note, update_note, list_folders, list_pdfs, search_pdfs,
list_references, get_reference, list_libraries, highlight, make_public,
agentic_search_papers, agentic_fetch_papers, browse_papersets, csv_read,
csv_write_cell). Each tool's description explains
what it does and what to pass — read the tool descriptions carefully before
calling.

If the user asks for a deep paper reading workflow, follow the `deep-read`
skill instructions.

Never use `glob`, `grep`, `ls`, or `read_file` to look for PDFs, notes, or
papers. If you need drive content, use the dedicated tools instead."""


def _build_memory_backend(*, user_id: str, store: BaseStore) -> CompositeBackend:
    """Build the deepagents filesystem backend with `/.episteme/agents/memories/`
    routed to real notes in the user's drive via NotesBackend.

    Working files (`/draft.txt`, scratch) stay ephemeral in StateBackend.
    Anything under `/.episteme/agents/memories/` is persisted as notes in
    Postgres (default library, `.episteme/agents/memories` folder), so library
    export captures them and the user can edit them in the drive UI.

    `store` is unused here but kept on the signature because deepagents may
    still require a `BaseStore` for unrelated middleware plumbing.
    """
    from backends.notes_backend import NotesBackend
    return CompositeBackend(
        default=StateBackend(),
        routes={"/.episteme/agents/memories/": NotesBackend(user_id=user_id)},
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
# enabled. Skills curate ADDITIONAL skill-specific tools (highlights, MCPs,
# extractors) on top of these. Without core discovery tools, basic asks ("list
# my notes", "find the X paper", "what libraries do I have") silently fail
# when any skill is toggled on. Action tools that should remain skill-scoped
# (highlight, etc.) are deliberately excluded.
_CORE_TOOL_NAMES: frozenset[str] = frozenset({
    # notes
    "list_notes", "search_notes", "read_note", "create_note", "update_note",
    "list_links", "list_backlinks",
    # references (bibliography)
    "list_references", "get_reference",
    # libraries / folders
    "list_libraries", "list_folders",
    # papers/PDFs (discovery only — action tools like `highlight` stay skill-scoped)
    "list_pdfs", "search_pdfs",
    # paper search (agentic — fetch is HITL-protected via skill require_approval)
    "agentic_search_papers", "agentic_fetch_papers",
    # papersets / extraction spreadsheets — list, read, and per-cell enrichment
    # are first-class user content (like notes), not gated to data-extract skill.
    # Without this, "list my papersets" silently routed to list_pdfs whenever
    # any skill was active (G-R6-15 / #107 round 6).
    "browse_papersets", "csv_read", "csv_write_cell",
    # NOTE: web_search (Tavily) is intentionally NOT core — it is a fallback
    # tool gated by per-user permission (`permissions.web_search`) and only
    # bound to the agent when the user has opted in. See
    # `_filter_tools_for_permissions`.
})


# Tools whose presence is gated by an explicit user permission flag.
# Mapping: permission key (in agent_configs.settings_json.permissions) → tool name.
_PERMISSION_GATED_TOOLS: dict[str, str] = {
    "web_search": "web_search",
}


def _filter_tools_for_permissions(
    tools: list[BaseTool],
    permissions: dict | None,
) -> list[BaseTool]:
    """Drop permission-gated tools whose flag is not explicitly True.

    Default-off semantics: missing key, None, False → tool excluded.
    """
    permissions = permissions or {}
    blocked: set[str] = {
        tool_name
        for perm_key, tool_name in _PERMISSION_GATED_TOOLS.items()
        if not permissions.get(perm_key)
    }
    return [t for t in tools if t.name not in blocked]


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


async def build_km_agent(
    *,
    user_id: str,
    thread_id: str,
    model: str,
    enabled_skills: list[str],
    approval_rules: dict,
    store,
    saver,
    permissions: dict | None = None,
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
    loaded = (
        await DriveSkillsLoader().load(enabled_skills, user_id=user_id, tolerant=True)
        if enabled_skills else []
    )
    tools = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=loaded)
    tools = _filter_tools_for_permissions(tools, permissions=permissions)
    subagents = _select_subagents(loaded, available_tools=tools)

    # Advertise enabled skills in the system prompt (name + description only).
    # Full skill bodies are not inlined to avoid token bloat; the agent reads
    # them on-demand via the filesystem tools when a skill matches the prompt.
    # SkillsMiddleware is disabled (skills=None) because it leaks absolute
    # filesystem paths in its advertisement.
    system_prompt = _MEMORY_SYSTEM_PROMPT
    if loaded:
        bullets = "\n".join(f"- **{s.name}**: {s.description}" for s in loaded)
        system_prompt += (
            "\n\n## Skills (workflows you execute INLINE)\n\n"
            "The following skills are enabled for this conversation. A skill is "
            "a workflow YOU execute step-by-step yourself, using your tools. "
            "Skills are NOT subagents and MUST NOT be passed to the `task` tool "
            "as a `subagent_type` — `task` only accepts the subagent types its "
            "own description lists.\n\n"
            "When the user's request matches a skill's description, follow the "
            "skill's instructions inline. If you need the full workflow, read "
            f"the skill's SKILL.md from `/.episteme/agents/skills/<name>/SKILL.md`.\n\n"
            f"{bullets}"
        )

    # Inject user-authored personal skills into the system prompt.
    # Personal skills are simple (name + instructions) and don't have
    # tools/subagents — they're inline instructions the agent follows.
    personal = await _fetch_personal_skills(user_id)
    if personal:
        skill_lines = []
        for ps in personal:
            name = ps.get("name") or ps.get("slug") or "unnamed"
            desc = ps.get("description") or ""
            instr = ps.get("instructions") or ""
            if instr:
                skill_lines.append(f"### {name}\n{desc}\n\n{instr}" if desc else f"### {name}\n{instr}")
            elif desc:
                skill_lines.append(f"### {name}\n{desc}")
        if skill_lines:
            system_prompt += (
                "\n\n## Personal Skills (user-authored)\n\n"
                "The user has defined these personal skills. Follow the "
                "instructions when the user's request matches the skill "
                "description.\n\n"
                + "\n\n".join(skill_lines)
            )

    return create_deep_agent(
        model=model,
        tools=tools,
        subagents=subagents,
        skills=None,
        system_prompt=system_prompt,
        store=store,
        checkpointer=saver,
        backend=_build_memory_backend(user_id=user_id, store=store),
        interrupt_on=_build_interrupt_on(approval_rules, loaded_skills=loaded),
    )
