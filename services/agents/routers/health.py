from fastapi import APIRouter
from deps.auth import InternalAuthDep

router = APIRouter(prefix="/agents", tags=["health"])


@router.api_route("/health", methods=["GET", "POST"])
async def health(_: InternalAuthDep) -> dict:
    return {"status": "ok"}
