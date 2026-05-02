import pytest

from rag.retriever import build_retriever


@pytest.mark.asyncio
async def test_retriever_filters_and_dedupes_chunk_ids():
    rows = [
        {"chunk_id": "c1", "content": "alpha", "source_kind": "note", "source_id": "n1", "score": 0.8},
        {"chunk_id": "c1", "content": "alpha-dup", "source_kind": "note", "source_id": "n1", "score": 0.7},
        {"chunk_id": "c2", "content": "beta", "source_kind": "paper", "source_id": "p1", "score": 0.9, "page": 2},
    ]
    retriever = build_retriever(rows=rows, library_id=1, kinds=["paper"], source_ids=["p1"], k=8)
    docs = await retriever.ainvoke("beta")
    assert len(docs) == 1
    assert docs[0].metadata["chunk_id"] == "c2"
    assert docs[0].metadata["source_kind"] == "paper"


@pytest.mark.asyncio
async def test_retriever_caps_k_to_8():
    rows = [{"chunk_id": f"c{i}", "content": "x", "source_kind": "note", "source_id": "n1", "score": 1 - i * 0.01} for i in range(20)]
    retriever = build_retriever(rows=rows, library_id=1, kinds=["all"], source_ids=None, k=99)
    docs = await retriever.ainvoke("x")
    assert len(docs) == 8
