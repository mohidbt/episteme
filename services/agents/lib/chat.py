import logging
from collections.abc import AsyncIterator
from typing import Any
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langchain_openai import ChatOpenAI
from lib.rag import ChunkRow

logging.basicConfig(level=logging.INFO, force=False)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
CHAT_MODEL = "openai/gpt-4o-mini"

AGENT_RECURSION_LIMIT = 40


def _build_system_prompt(supporting_chunks: list[ChunkRow], page_text: str | None,
                         anchor_text: str | None, selection_text: str | None,
                         scope: str, focus_page: int | None) -> str:
    sections = [
        "You are a research assistant answering questions about a single PDF.",
        "Cite page numbers inline as (p. N) whenever you draw on the material.",
        "Prefer the provided material; if it is insufficient, say what specifically is missing rather than refusing outright.",
        "Do not claim you only have access to a single page unless the user explicitly scoped the question to one page.",
        "If the provided material contains any relevant information, answer with citations; do not ask the user to narrow the question when content is available.",
    ]

    if scope == "selection" and selection_text:
        sections.append(f"\n--- User selection (page {focus_page or '?'}) ---\n{selection_text}")
    if scope in ("selection", "page") and page_text:
        sections.append(f"\n--- Current page (page {focus_page}) ---\n{page_text}")
    if scope == "paper" and anchor_text:
        sections.append(f"\n--- Paper opening (page 1) ---\n{anchor_text}")

    if supporting_chunks:
        supporting_text = "\n\n---\n\n".join(f"[Page {r.page_start}]\n{r.content}" for r in supporting_chunks)
        sections.append(f"\n--- Supporting context (retrieved across the document) ---\n{supporting_text}")

    return "\n".join(sections)


async def run_chat(*, api_key: str, history: list[dict], question: str,
                   supporting_chunks: list[ChunkRow], page_text: str | None,
                   anchor_text: str | None, selection_text: str | None,
                   scope: str, focus_page: int | None,
                   tools: list | None = None,
                   tool_hints: list[str] | None = None,
                   system_prompt: str | None = None) -> AsyncIterator[tuple]:
    """Yield ('token', str) for LLM text, ('tool_call', name, args), ('tool_result', name, result)."""
    # When a toolbelt is in play, mirror the slash-path: disable streaming so
    # the agent loop runs to completion with reliable tool discipline, and
    # pass system_prompt to create_agent so it's re-applied each iteration.
    use_streaming = not bool(tool_hints)
    model = ChatOpenAI(
        model=CHAT_MODEL, base_url=OPENROUTER_BASE, api_key=api_key,
        streaming=use_streaming,
    )
    system = _build_system_prompt(supporting_chunks, page_text, anchor_text, selection_text, scope, focus_page)
    if tool_hints:
        # Prepend: RAG prompt + supporting chunks can be long; burying the
        # toolbelt hint at the bottom causes the LLM to default to inline
        # answers even when the user explicitly asks to highlight.
        system = "\n\n".join(tool_hints) + "\n\n" + system

    messages: list[Any] = [{"role": "system", "content": system}]
    messages.extend(history[-10:])
    messages.append({"role": "user", "content": question})

    agent_kwargs: dict[str, Any] = {"model": model, "tools": tools or []}
    if tool_hints:
        # Re-applying the toolbelt system prompt each loop iteration matches
        # the slash path, where gpt-4o-mini reliably calls locate_phrase before
        # create_highlights. Inline system message alone is less reliable.
        agent_kwargs["system_prompt"] = system_prompt or system
    agent = create_agent(**agent_kwargs)

    def _dbg(*a):
        print("[IMPLICIT-DEBUG]", *a, flush=True)

    _dbg(f"run_chat start: tools={len(tools or [])} question={question[:80]!r}")

    async for mode, payload in agent.astream(
        {"messages": messages},
        config={"recursion_limit": AGENT_RECURSION_LIMIT},
        stream_mode=["messages", "updates"],
    ):
        _dbg(f"astream mode={mode} payload_type={type(payload).__name__}")
        if mode == "messages":
            chunk = payload[0] if isinstance(payload, tuple) else payload
            _dbg(
                f"  messages chunk_type={type(chunk).__name__} "
                f"content_type={type(getattr(chunk, 'content', None)).__name__} "
                f"content_preview={str(getattr(chunk, 'content', ''))[:60]!r} "
                f"tool_call_chunks={getattr(chunk, 'tool_call_chunks', None)} "
                f"tool_calls={getattr(chunk, 'tool_calls', None)}"
            )
            if isinstance(chunk, AIMessageChunk) and isinstance(chunk.content, str) and chunk.content:
                yield ("token", chunk.content)
        elif mode == "updates":
            _dbg(f"  updates keys={list((payload or {}).keys())}")
            for node_name, node_state in (payload or {}).items():
                msgs = (node_state or {}).get("messages", []) or []
                _dbg(f"    node={node_name} msg_count={len(msgs)} types={[type(m).__name__ for m in msgs]}")
                for m in msgs:
                    if isinstance(m, AIMessage):
                        _dbg(f"      AIMessage tool_calls={m.tool_calls} content_preview={str(m.content)[:80]!r}")
                        for tc in m.tool_calls or []:
                            yield ("tool_call", tc.get("name", "tool"), tc.get("args") or {})
                    elif isinstance(m, ToolMessage):
                        _dbg(f"      ToolMessage name={m.name} content_preview={str(m.content)[:400]!r}")
                        yield ("tool_result", m.name or "tool", m.content)
