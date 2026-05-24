"""K7: ensure pdf_read_text tool is removed (use read_paper(kind='pages') instead)."""


def test_pdf_read_text_not_in_tool_set():
    from tools.pdfs import TOOLS

    names = {t.name for t in TOOLS}
    assert "pdf_read_text" not in names
