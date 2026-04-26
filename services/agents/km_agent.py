"""KM agent factory — builds a Deep Agent for the episteme knowledge manager.

The factory wires:
- ALL_TOOLS: domain tools (notes, pdfs, library, revisions, publish)
- interrupt_on: HITL approval rules per master spec
- subagents/skills: empty in Phase 1.3a, populated in 1.3b
- checkpointer/store: passed in by caller (from checkpointer.py / store.py)

Note on filesystem backend
--------------------------
create_deep_agent's built-in backend (default: StateBackend) handles the
agent's working-file context (scratch files, temp notes).  The domain
backends from Task 3 (NotesBackend, PdfsBackend, etc.) are accessed through
ALL_TOOLS — they are tool-based adapters, not filesystem backends.
"""
from deepagents import create_deep_agent
from langgraph.graph.state import CompiledStateGraph

from tools import ALL_TOOLS


def _build_interrupt_on(approval_rules: dict) -> dict[str, bool]:
    """Build interrupt_on dict from tool metadata + approval_rules overrides."""
    interrupt_on: dict[str, bool] = {}

    # Auto-detect tools that advertise require_approval in metadata
    for tool in ALL_TOOLS:
        if tool.metadata and tool.metadata.get("require_approval"):
            interrupt_on[tool.name] = True

    # Spec-mandated overrides (approval_rules take precedence over metadata)
    interrupt_on["make_public"] = approval_rules.get("publish", "require") == "require"
    interrupt_on["external_send"] = approval_rules.get("external_send", "require") == "require"
    interrupt_on["create_note"] = approval_rules.get("write_note", "auto") == "require"

    return interrupt_on


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
        enabled_skills: Skill directory paths to enable (empty in 1.3a).
        approval_rules: Dict mapping action names to "require"/"auto".
        store: LangGraph BaseStore (InMemoryStore or PostgresStore).
        saver: LangGraph BaseCheckpointSaver (MemorySaver or PostgresSaver).

    Returns:
        Compiled StateGraph ready to invoke.
    """
    return create_deep_agent(
        model=model,
        tools=list(ALL_TOOLS),
        subagents=[],
        skills=enabled_skills or [],
        store=store,
        checkpointer=saver,
        interrupt_on=_build_interrupt_on(approval_rules),
    )
