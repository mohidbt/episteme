from pydantic import BaseModel


class SectionOut(BaseModel):
    id: int
    documentId: int
    sectionIndex: int
    title: str | None
    content: str
    pageStart: int
    pageEnd: int
    createdAt: str
