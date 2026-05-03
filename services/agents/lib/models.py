from pydantic import BaseModel


class SectionOut(BaseModel):
    id: int
    paperId: str
    sectionIndex: int
    title: str | None
    content: str
    pageStart: int
    pageEnd: int
    createdAt: str
