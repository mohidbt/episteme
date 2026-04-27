"""NotesBackend — filesystem-shaped adapter over the notes tool registry.

Paths:
  /notes/<slug-or-id>.md  — single note
  /notes/                 — directory listing

write() first attempts to resolve the slug to an existing note via read_note and
then calls update_note. If read_note raises (note not found), it falls back to
create_note using the slug as the title. This fallback is intentional — slug→id
resolution via a dedicated KM search route is deferred to task 1.3b.
"""
from tools.notes import create_note, list_notes, read_note, update_note


class NotesBackend:
    def __init__(self, user_id: str) -> None:
        self._user_id = user_id
        # `user_id` is now read from RunnableConfig.configurable by every tool
        # (see §1.3b-E2E-3); the backend supplies it via this per-instance
        # config rather than as a tool arg.
        self._cfg = {"configurable": {"user_id": user_id}}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _strip(self, path: str) -> str:
        """Extract slug/id from /notes/<slug>.md."""
        name = path.removeprefix("/notes/")
        if name.endswith(".md"):
            name = name[:-3]
        return name

    # ------------------------------------------------------------------
    # Backend interface
    # ------------------------------------------------------------------

    async def read(self, path: str) -> str:
        id_or_slug = self._strip(path)
        result = await read_note.ainvoke({"id_or_slug": id_or_slug}, config=self._cfg)
        return result["contentMd"]

    async def ls(self, path: str) -> list[str]:
        notes = await list_notes.ainvoke({}, config=self._cfg)
        paths = []
        for note in notes:
            name = note.get("slug") or note.get("id", "unknown")
            paths.append(f"{name}.md")
        return paths

    async def write(self, path: str, content: str) -> None:
        slug = self._strip(path)
        try:
            existing = await read_note.ainvoke({"id_or_slug": slug}, config=self._cfg)
            note_id = existing["id"]
            await update_note.ainvoke(
                {"id": note_id, "contentMd": content}, config=self._cfg
            )
        except Exception:
            # Fallback: create new note using slug as title
            await create_note.ainvoke(
                {"title": slug, "contentMd": content}, config=self._cfg
            )

    async def delete(self, path: str) -> None:
        raise NotImplementedError("delete is not supported — no delete-note tool exists")
