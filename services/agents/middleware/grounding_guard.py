"""GroundingGuard — middleware that enforces read-before-write for csv_write_cell.

A model must call read_paper(paper_id=X, ...) before writing a cell whose
grounding references paper X.  Without this guard, the model can hallucinate
cell values referencing a paper it has never read.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.messages import AIMessage, ToolMessage


def _read_paper_targeted(
    messages: list,
    tool_msg: ToolMessage,
    paper_id: str,
) -> bool:
    """Return True when *tool_msg* traces back to a read_paper call for *paper_id*.

    Walk *messages* looking for an AIMessage whose tool_calls list has an
    entry with id == tool_msg.tool_call_id and name == "read_paper" and
    args["paper_id"] == paper_id.
    """
    target_id = getattr(tool_msg, "tool_call_id", None)
    if not target_id:
        return False

    for m in messages:
        if not isinstance(m, AIMessage):
            continue
        for tc in getattr(m, "tool_calls", []) or []:
            if (
                tc.get("id") == target_id
                and tc.get("name") == "read_paper"
                and tc.get("args", {}).get("paper_id") == paper_id
            ):
                return True
    return False


class GroundingGuard(AgentMiddleware):
    """Enforce read_paper-before-write for csv_write_cell cells with grounding.

    If the cell's ``grounding.paper_id`` is set but no prior ``read_paper``
    call for that paper exists in the conversation history, the write is
    blocked with an error ToolMessage — forcing the model to read the paper
    first.

    Cells with empty/missing grounding (e.g. n/a cells filled without a paper
    reference) bypass this guard; downstream validation in cell-write.ts
    handles the n/a-without-observation case.
    """

    async def awrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], Awaitable[ToolMessage]],
    ) -> ToolMessage:
        # Only guard csv_write_cell calls.
        if request.tool.name != "csv_write_cell":
            return await handler(request)

        args = request.tool_call.get("args", {}) or {}
        grounding = args.get("grounding") or {}
        paper_id = grounding.get("paper_id")

        # No paper_id in grounding → nothing to guard.
        if not paper_id:
            return await handler(request)

        messages = request.state.get("messages", []) if isinstance(request.state, dict) else []

        # Find ToolMessages from read_paper that targeted this paper_id.
        prior = [
            m for m in messages
            if isinstance(m, ToolMessage)
            and getattr(m, "name", None) == "read_paper"
            and _read_paper_targeted(messages, m, paper_id)
        ]

        if not prior:
            return ToolMessage(
                content=(
                    f"error: forbidden — must call read_paper(paper_id='{paper_id}', scope=...) "
                    "before writing this cell. Empty grounding for non-n/a values is rejected; "
                    "writing 'n/a' without first observing the paper is also rejected."
                ),
                name=request.tool.name,
                tool_call_id=request.tool_call["id"],
                status="error",
            )

        return await handler(request)
