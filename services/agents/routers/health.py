from fastapi import APIRouter
from deps.auth import InternalAuthDep

router = APIRouter(prefix="/agents", tags=["health"])


async def _health(_: InternalAuthDep) -> dict:
    return {"status": "ok"}


@router.get("/health", operation_id="health_agents_health_get")
async def health_get(_: InternalAuthDep) -> dict:
    return await _health(_)


@router.post("/health", operation_id="health_agents_health_post")
async def health_post(_: InternalAuthDep) -> dict:
    return await _health(_)
