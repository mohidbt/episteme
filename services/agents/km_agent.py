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
from middleware.grounding_guard import GroundingGuard
from skills import SkillSpec
from skills.drive_loader import DriveSkillsLoader
from subagents import build_researcher, build_synthesizer, build_verifier
from tools import ALL_TOOLS

logger = logging.getLogger(__name__)


async def _fetch_personal_skills(user_id: str) -> list[dict]:
    """Fetch user-authored personal skills from the KM API.

    Returns a list of {slug, name, description, instructions} dicts.
    On failure returns [] (non-fatal — personal skills are best-effort).

    Observability: logs an INFO line with the fetched count on success, and
    a WARNING with the full error body when km_get returns its structured
    error dict ({"error": True, "status": ..., "body": ...}) — without this
    a silent 401/500 from KM looked identical to "user has 0 skills".
    """
    try:
        resp = await km_get("/api/agents/skills/personal", user_id=user_id)
    except Exception:  # noqa: BLE001
        logger.exception("personal_skills fetch raised for user=%s", user_id)
        return []

    if isinstance(resp, dict) and resp.get("error") is True:
        logger.warning(
            "personal_skills fetch returned error user=%s status=%s body=%r",
            user_id,
            resp.get("status"),
            resp.get("body"),
        )
        return []

    if isinstance(resp, dict) and isinstance(resp.get("skills"), list):
        personal = [s for s in resp["skills"] if isinstance(s, dict)]
        logger.info("personal_skills fetched count=%d user=%s", len(personal), user_id)
        return personal

    logger.warning(
        "personal_skills fetch unexpected shape user=%s resp_type=%s",
        user_id,
        type(resp).__name__,
    )
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
read_note, create_note, update_note, list_folders, find_papers,
list_references, get_reference, list_libraries, highlight, make_public,
agentic_search_papers, agentic_fetch_papers, browse_papersets, csv_read,
csv_write_cell). Each tool's description explains
what it does and what to pass — read the tool descriptions carefully before
calling.

If the user asks for a deep paper reading workflow, follow the `deep-read`
skill instructions.

Never use `glob`, `grep`, `ls`, or `read_file` to look for PDFs, notes, or
papers. If you need drive content, use the dedicated tools instead."""


def _build_memory_backend(
    *,
    user_id: str,
    store: BaseStore,
    enabled_skills: list[str] | None = None,
    personal_skills: list[dict] | None = None,
) -> CompositeBackend:
    """Build the deepagents filesystem backend with `/.episteme/agents/memories/`
    routed to real notes in the user's drive via NotesBackend.

    Working files (`/draft.txt`, scratch) stay ephemeral in StateBackend.
    Anything under `/.episteme/agents/memories/` is persisted as notes in
    Postgres (default library, `.episteme/agents/memories` folder), so library
    export captures them and the user can edit them in the drive UI.

    `enabled_skills` (when not None) scopes the SkillsBackend allow-list so
    SkillsMiddleware's prompt advertisement only lists those skills.

    `personal_skills` are user-authored skills (slug/name/description/
    instructions dicts from /api/agents/skills/personal). They're surfaced as
    first-class SkillSpecs by SkillsBackend — advertised by description,
    instructions loaded on demand by read_file (progressive disclosure).

    `store` is unused here but kept on the signature because deepagents may
    still require a `BaseStore` for unrelated middleware plumbing.
    """
    from backends.notes_backend import NotesBackend
    from backends.skills_backend import SkillsBackend
    skills_enabled = frozenset(enabled_skills) if enabled_skills is not None else None
    return CompositeBackend(
        default=StateBackend(),
        routes={
            "/.episteme/agents/memories/": NotesBackend(user_id=user_id),
            "/.episteme/agents/skills/":   SkillsBackend(
                enabled=skills_enabled,
                personal_skills=personal_skills,
            ),
        },
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
    _apply_rule(interrupt_on, "highlight", approval_rules.get("highlight"), default="require")

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
# when any skill is toggled on.
_CORE_TOOL_NAMES: frozenset[str] = frozenset({
    # notes
    "list_notes", "search_notes", "read_note", "create_note", "update_note",
    "list_links", "list_backlinks",
    # references (bibliography)
    "list_references", "get_reference",
    # libraries / folders
    "list_libraries", "list_folders",
    # papers/PDFs (discovery + reader actions). read_paper / pdf_explain_passage
    # power the reader side-panel agent (multi-page reads, full-page reads,
    # SelectionToolbar "Explain") and are named verbatim in the
    # [reader-context] system prefix (see routers/km_agent.py::
    # _build_reader_context_prefix); without them in core, enabling any skill
    # whose tools list omits them (e.g. lit-triage) silently pruned them and
    # the LLM hallucinated calls to a name it could not actually invoke.
    "find_papers", "read_paper", "pdf_explain_passage",
    # reader annotation action — kept core so highlighting remains available
    # regardless of the currently enabled skill set.
    "highlight",
    # paper search (agentic — fetch is HITL-protected via skill require_approval).
    # NOTE: search_library is intentionally NOT core — it is cross-library RAG
    # and should be opted into per skill (see deep-read SKILL.md) rather than
    # blanket-promoted across every skill context.
    "agentic_search_papers", "agentic_fetch_papers", "search_papers_online",
    # papersets / extraction spreadsheets — list, read, and per-cell enrichment
    # are first-class user content (like notes), not gated to data-extract skill.
    # Without this, "list my papersets" silently routed to list_pdfs whenever
    # any skill was active (G-R6-15 / #107 round 6).
    "browse_papersets", "csv_read", "csv_write_cell",
    # web_search (Tavily) — core, default-ON, permission-opt-out.
    # Conceptually web_search is "always available unless the user explicitly
    # opts out". It belongs in CORE because:
    #   1. The permission filter (`_filter_tools_for_permissions`) is the
    #      SINGLE source of truth for whether it is bound. CORE membership
    #      keeps `_filter_tools_for_skills` from silently pruning it.
    #   2. Authoring SKILL.md frontmatter to list `web_search` per-skill is
    #      footgunny — every new skill would have to remember to opt in, or
    #      else enabling that skill would silently disable the web. The K12
    #      UI toggle was decorative until this was fixed (live bug: model
    #      replied "there is no web_search tool" once any skill was on).
    # The opt-out flow remains: settings_json.permissions.web_search = False
    # → `_filter_tools_for_permissions` drops the tool after the skill
    # filter has already kept it.
    "web_search",
})


def _filter_tools_for_permissions(
    tools: list[BaseTool],
    permissions: dict | None,
) -> list[BaseTool]:
    """Drop any tool whose permission flag is explicitly False (GSD-33).

    Default-ON semantics: missing key, None → tool included. Only an explicit
    ``False`` filters the tool out, so users must take an explicit opt-out
    action via the settings UI. Keyed by tool name directly — there is no
    longer a perm_key → tool_name indirection (every tool's name IS its
    permission key).
    """
    permissions = permissions or {}
    return [t for t in tools if permissions.get(t.name) is not False]


def _build_disabled_tools_addendum(
    permissions: dict | None,
    *,
    all_tool_names: set[str],
    skill_filtered_names: set[str],
) -> str:
    """Return a system-prompt addendum listing permission-disabled tools.

    Only includes tools that:
    1. The user has explicitly disabled (``permissions[name] is False``), AND
    2. Survived the skill filter (i.e. would have been bound otherwise).

    Returning "" means the caller should not append an addendum at all
    (no permission-disabled tool remains after skill filtering).
    """
    permissions = permissions or {}
    disabled = sorted(
        name
        for name in all_tool_names
        if permissions.get(name) is False and name in skill_filtered_names
    )
    if not disabled:
        return ""
    bullets = "\n".join(f"- `{name}`" for name in disabled)
    return (
        "## Tool restrictions\n\n"
        "The user has disabled the following tools in their settings. "
        "Do not attempt to call them. If the user asks for a capability that "
        "requires one of these tools, tell them the tool is disabled in their "
        "settings and they can re-enable it under Settings → Agent → Tools.\n\n"
        f"{bullets}"
    )


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
        Skill advertisement is scoped to ``enabled_skills`` via the
        ``SkillsBackend(enabled=...)`` filter in ``_build_memory_backend``.
        ``SkillsMiddleware._alist_skills`` only sees the allow-listed subdirs,
        so the system prompt advertises only enabled skills (matching the
        existing tool-filter behavior in ``_filter_tools_for_skills``).
    """
    loaded = (
        await DriveSkillsLoader().load(enabled_skills, user_id=user_id, tolerant=True)
        if enabled_skills else []
    )
    tools_after_skill_filter = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=loaded)
    tools = _filter_tools_for_permissions(tools_after_skill_filter, permissions=permissions)
    subagents = _select_subagents(loaded, available_tools=tools)

    system_prompt = _MEMORY_SYSTEM_PROMPT
    _disabled_addendum = _build_disabled_tools_addendum(
        permissions,
        all_tool_names={t.name for t in ALL_TOOLS},
        skill_filtered_names={t.name for t in tools_after_skill_filter},
    )
    if _disabled_addendum:
        system_prompt = system_prompt + "\n\n" + _disabled_addendum

    # Personal (user-authored) skills are first-class SkillSpecs surfaced
    # through SkillsMiddleware — name + description in the prompt, body
    # loaded on demand by read_file. No unconditional concatenation.
    personal = await _fetch_personal_skills(user_id)

    backend = _build_memory_backend(
        user_id=user_id,
        store=store,
        enabled_skills=enabled_skills,
        personal_skills=personal,
    )
    # Observability: log how many personal slots SkillsBackend ended up with —
    # this is what the SkillsMiddleware enumerates for the system prompt.
    try:
        from backends.skills_backend import SkillsBackend  # noqa: PLC0415
        _skills_be = next(
            (b for b in backend.routes.values() if isinstance(b, SkillsBackend)),
            None,
        )
        if _skills_be is not None:
            logger.info(
                "SkillsBackend personal slots=%d user=%s",
                len(_skills_be._personal),
                user_id,
            )
    except Exception:  # noqa: BLE001
        logger.exception("failed to introspect SkillsBackend slots user=%s", user_id)

    return create_deep_agent(
        model=model,
        tools=tools,
        subagents=subagents,
        skills=["/.episteme/agents/skills/"],
        system_prompt=system_prompt,
        store=store,
        checkpointer=saver,
        backend=backend,
        interrupt_on=_build_interrupt_on(approval_rules, loaded_skills=loaded),
        middleware=[GroundingGuard()],
    )
