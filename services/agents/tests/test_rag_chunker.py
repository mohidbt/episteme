from rag.chunker import chunk_markdown_note, chunk_pdf_pages


def test_chunk_markdown_note_has_metadata_and_ranges():
    md = "# A\n\n" + ("hello world " * 400)
    chunks = chunk_markdown_note(note_id="n1", markdown=md)
    assert len(chunks) >= 2
    first = chunks[0]
    assert first.metadata["source_kind"] == "note"
    assert first.metadata["source_id"] == "n1"
    assert "chunk_id" in first.metadata
    assert len(first.content) <= 1700
    assert first.metadata["char_range"][0] <= first.metadata["char_range"][1]


def test_chunk_pdf_pages_tracks_page_and_ranges():
    pages = [
        {"pageNumber": 1, "text": "a " * 1200},
        {"pageNumber": 2, "text": "b " * 1200},
    ]
    chunks = chunk_pdf_pages(paper_id="p1", pages=pages)
    assert len(chunks) > 2
    assert {c.metadata["page"] for c in chunks} == {1, 2}
    assert all(c.metadata["source_kind"] == "paper" for c in chunks)
