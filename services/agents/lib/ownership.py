"""Fail-closed tenant ownership guards for direct database access paths."""


class ResourceNotOwned(LookupError):
    """The requested resource is absent or belongs to another tenant."""


async def require_paper_owner(conn, *, paper_id: str, user_id: str):
    row = await conn.fetchrow(
        "SELECT id, title, storage_url, processing_status "
        "FROM papers WHERE id = $1 AND user_id = $2",
        paper_id,
        user_id,
    )
    if not row:
        raise ResourceNotOwned("paper not found")
    return row
