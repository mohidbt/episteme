import os
import httpx
from langchain_openai import ChatOpenAI

EMBED_MODEL = "openai/text-embedding-3-small"
EMBED_URL = "https://openrouter.ai/api/v1/embeddings"
EMBED_DIM = 1536

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
CHAT_MODEL = "openai/gpt-4o-mini"


async def call_model(api_key: str, system: str, user_content: str) -> str:
    """Non-streaming model call. Returns full text response."""
    model = ChatOpenAI(
        model=CHAT_MODEL,
        base_url=OPENROUTER_BASE,
        api_key=api_key,
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    response = await model.ainvoke(messages)
    return response.content


async def embed_texts(api_key: str, inputs: list[str]) -> list[list[float]]:
    if not inputs:
        return []
    if os.environ.get("INHALE_STUB_EMBEDDINGS") == "1":
        return [[0.01] * EMBED_DIM for _ in inputs]
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            EMBED_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": EMBED_MODEL, "input": inputs},
        )
        r.raise_for_status()
        data = r.json()["data"]
        return [d["embedding"] for d in data]
