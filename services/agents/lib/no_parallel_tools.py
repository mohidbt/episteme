"""Middleware that disables parallel tool calls for a create_agent agent.

GSD-138: when the model emits two tool calls in one assistant turn, OpenRouter/
OpenAI cancels one branch ("another message came in before it could be
completed"). For the highlight toolset the discarded branch is often
`create_highlights`, so highlights never persist and the stream dies silently.

`ChatOpenAI` has no `parallel_tool_calls` constructor field; the flag is applied
at bind time. `create_agent` binds tools via
`model.bind_tools(tools, **request.model_settings)`, so injecting the flag into
`model_settings` is the supported seam.

Both real call sites (routers/auto_highlight.py, lib/chat.py) drive the agent
with `.astream(...)`, which routes through the ASYNC hook `awrap_model_call`.
The `@wrap_model_call` decorator on a *sync* function only installs the sync
hook, so on `.astream()` langchain's base `awrap_model_call` raises
NotImplementedError and the flag never reaches `bind_tools` — the parallel-call
cancellation keeps happening. We therefore implement BOTH hooks on a class-based
`AgentMiddleware` so the flag lands on the sync (`.invoke`) and async
(`.astream`/`.ainvoke`) paths alike.
"""
from collections.abc import Awaitable, Callable

from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
)


def _force_no_parallel(request: ModelRequest) -> ModelRequest:
    return request.override(
        model_settings={**request.model_settings, "parallel_tool_calls": False}
    )


class NoParallelToolCalls(AgentMiddleware):
    """Force `parallel_tool_calls=False` when binding tools, sync and async."""

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(_force_no_parallel(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(_force_no_parallel(request))


# Shared instance wired into both the auto-highlight and chat toolbelt agents.
no_parallel_tool_calls = NoParallelToolCalls()
