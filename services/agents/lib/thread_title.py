"""Auto-generate short human-readable titles for agent threads.

Used by the /agents page ThreadList: when a thread has no title yet, we
ask a small/cheap model to summarize its first user message into a 3-7
word phrase and persist it on agent_threads.title.

Library-only for now — no router wiring. Next.js can call into this via
a future endpoint or call OpenRouter directly. See task #9 plan.
"""
from lib.openrouter_client import call_model

DEFAULT_MODEL = "google/gemma-4-26b-a4b-it"
MAX_TITLE_LEN = 60
MAX_INPUT_LEN = 500

_SYSTEM_PROMPT = (
    "You generate short titles for chat threads. "
    "Given the user's first message, reply with a 3-7 word title in plain English. "
    "No quotes. No trailing period. No prefixes like 'Title:'. Just the title."
)

_TRAILING_PUNCT = ".!?,;: \t\n\r"


def _clean(raw: str) -> str:
    s = raw.strip()
    # Strip surrounding quotes (single, double, smart).
    while len(s) >= 2 and s[0] in "\"'“‘" and s[-1] in "\"'”’":
        s = s[1:-1].strip()
    s = s.rstrip(_TRAILING_PUNCT)
    if len(s) > MAX_TITLE_LEN:
        s = s[:MAX_TITLE_LEN].rstrip()
    return s


async def generate_title(
    api_key: str,
    first_user_message: str,
    model: str = DEFAULT_MODEL,
) -> str:
    """Generate a 3-7 word title for a thread from its first user message.

    Returns a stripped string. On any failure, returns "" so the caller
    can fall back to a default like "Conversation #abc123".

    Routes through call_model with explicit model override.
    """
    msg = (first_user_message or "").strip()
    if not msg:
        return ""
    truncated = msg[:MAX_INPUT_LEN]
    try:
        raw = await call_model(api_key, _SYSTEM_PROMPT, truncated, model=model)
    except Exception:
        return ""
    if not raw:
        return ""
    return _clean(raw)


async def maybe_set_thread_title(
    conn,
    user_id: str,
    thread_id: str,
    first_user_message: str,
    api_key: str,
) -> str | None:
    """Generate + persist a title if the thread row doesn't have one yet.

    Returns the new title string on success, or None if no update was
    made (row missing, title already set, empty input, generation failed).

    The UPDATE includes a `title IS NULL` predicate to guard against a
    racing concurrent writer.
    """
    if not (first_user_message or "").strip():
        return None

    row = await conn.fetchrow(
        "SELECT title FROM agent_threads WHERE user_id=$1 AND thread_id=$2",
        user_id, thread_id,
    )
    if row is None:
        return None
    if row["title"] is not None:
        return None

    title = await generate_title(api_key, first_user_message)
    if not title:
        return None

    await conn.execute(
        "UPDATE agent_threads SET title=$3, updated_at=now() "
        "WHERE user_id=$1 AND thread_id=$2 AND title IS NULL",
        user_id, thread_id, title,
    )
    return title
