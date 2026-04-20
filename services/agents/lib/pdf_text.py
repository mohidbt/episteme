from pypdf import PdfReader


def extract_pages(file_path: str) -> list[dict]:
    """Extract text from each page of a PDF. Returns list of {page_number, text}."""
    reader = PdfReader(file_path)
    return [
        {"page_number": i + 1, "text": page.extract_text() or ""}
        for i, page in enumerate(reader.pages)
    ]
