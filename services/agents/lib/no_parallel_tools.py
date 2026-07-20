"""Middleware that disables parallel tool calls for a create_agent agent.

GSD-138: when the model emits two tool calls in one assistant turn, OpenRouter/
OpenAI cancels one branch ("another message came in before it could be
completed"). For the highlight toolset the discarded branch is often
`create_highlights`, so highlights never persist and the stream dies silently.

`ChatOpenAI` has no `parallel_tool_calls` constructor field; the flag is applied
at bind time. `create_agent` binds tools via
`model.bind_tools(tools, **request.model_settings)`, so a `wrap_model_call`
middleware that injects the flag into `model_settings` is the supported seam.
"""
from collections.abc import Callable

from langchain.agents.middleware import (
    ModelRequest,
    ModelResponse,
    wrap_model_call,
)


@wrap_model_call
def no_parallel_tool_calls(
    request: ModelRequest,
    handler: Callable[[ModelRequest], ModelResponse],
) -> ModelResponse:
    """Force `parallel_tool_calls=False` when binding tools for this call."""
    request = request.override(
        model_settings={**request.model_settings, "parallel_tool_calls": False}
    )
    return handler(request)
