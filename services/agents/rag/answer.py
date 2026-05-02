from __future__ import annotations


def build_answer_prompt(question: str, chunks: list[dict]) -> str:
    context = "\n\n".join(
        f"[{c.get('chunk_id','?')}] {c.get('content','')}" for c in chunks
    )
    return (
        "Answer using only provided chunks.\n"
        "Every factual claim must include a chunk id citation like [chunk_id].\n\n"
        f"Question: {question}\n\n"
        f"Context:\n{context}"
    )
