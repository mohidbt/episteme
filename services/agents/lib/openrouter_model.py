"""OpenRouter model factory.

Returns a ChatOpenAI configured for the OpenRouter API with streaming enabled.
"""
from langchain_openai import ChatOpenAI

from lib.chat import OPENROUTER_BASE


def model_for(model_id: str, api_key: str) -> ChatOpenAI:
    """Return a streaming ChatOpenAI pointed at OpenRouter for model_id."""
    return ChatOpenAI(
        model=model_id,
        base_url=OPENROUTER_BASE,
        api_key=api_key,
        streaming=True,
    )
