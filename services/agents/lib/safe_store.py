"""Defensive wrapper around langgraph BaseStore.

Background
----------
``langgraph.store.postgres.base._row_to_search_item`` decodes each row's
``value`` column as JSON via ``orjson.loads``.  Rows written by older code
paths in dev (before serialization stabilized) can hold non-JSON bytes and
explode the whole call with ``orjson.JSONDecodeError`` — taking down every
agent run that did ``ls(/memories)`` or ``ls(/scratch)``.

Because the postgres ``_batch_search_ops`` / ``_batch_get_ops`` paths build
their result list with a comprehension, a single bad row aborts the entire
batch.  We can't filter row-by-row from outside, but we *can* catch the
decode error at the call boundary and degrade gracefully:

* ``asearch`` / ``search`` → return ``[]`` and log a warning
* ``aget`` / ``get`` → return ``None`` and log a warning

That's preferable to crashing the agent.  The opt-in reset script in
``scripts/reset_langgraph_store.py`` is the actual cleanup mechanism.

Wrapped methods (chosen by inspecting deepagents'
``backends/store.py`` — see ``StoreBackend`` which calls ``store.search``,
``store.get``, ``store.aget``, ``store.put``, ``store.aput``):

* aget / get          — read paths that hit ``_row_to_item``
* asearch / search    — read paths that hit ``_row_to_search_item``
* aput / put          — write paths (passthrough; no defense needed)
* abatch / batch      — passthrough so deepagents-internal use still works
* adelete / delete    — passthrough
* alist_namespaces / list_namespaces — passthrough (no JSON decode)

Plus we proxy any other attribute access via ``__getattr__`` so callers
that reach for less-common methods (``setup``, ``ttl_config``, …) still
work without us having to enumerate them.
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

import orjson
from langgraph.store.base import BaseStore

if TYPE_CHECKING:
    from langgraph.store.base import Item, SearchItem

logger = logging.getLogger(__name__)

# Decode errors we treat as "stale row, skip it" rather than "fatal bug".
_DECODE_ERRORS: tuple[type[BaseException], ...] = (orjson.JSONDecodeError, json.JSONDecodeError)


class SafeStore(BaseStore):
    """Proxy ``BaseStore`` that turns row-decode crashes into log-and-skip.

    The wrapped store handles all real persistence; this class only sits on
    the read methods that can raise ``orjson.JSONDecodeError`` from a
    poisoned row in the underlying ``store`` table.
    """

    def __init__(self, inner: BaseStore) -> None:
        self._inner = inner

    # --- introspection / passthrough -------------------------------------
    @property
    def supports_ttl(self) -> bool:
        return self._inner.supports_ttl

    @property
    def ttl_config(self) -> Any:
        return self._inner.ttl_config

    def __getattr__(self, name: str) -> Any:
        # Called only when normal attribute lookup fails — i.e. we haven't
        # overridden the attribute.  Forward to the wrapped store.
        return getattr(self._inner, name)

    # --- read paths (defensive) ------------------------------------------
    async def aget(
        self,
        namespace: tuple[str, ...],
        key: str,
        *,
        refresh_ttl: bool | None = None,
    ) -> Item | None:
        try:
            return await self._inner.aget(namespace, key, refresh_ttl=refresh_ttl)
        except _DECODE_ERRORS as exc:
            logger.warning(
                "SafeStore.aget skipping unparseable row namespace=%s key=%s: %s",
                namespace,
                key,
                exc,
            )
            return None

    def get(
        self,
        namespace: tuple[str, ...],
        key: str,
        *,
        refresh_ttl: bool | None = None,
    ) -> Item | None:
        try:
            return self._inner.get(namespace, key, refresh_ttl=refresh_ttl)
        except _DECODE_ERRORS as exc:
            logger.warning(
                "SafeStore.get skipping unparseable row namespace=%s key=%s: %s",
                namespace,
                key,
                exc,
            )
            return None

    async def asearch(
        self,
        namespace_prefix: tuple[str, ...],
        /,
        *,
        query: str | None = None,
        filter: dict[str, Any] | None = None,  # noqa: A002 — mirrors BaseStore signature
        limit: int = 10,
        offset: int = 0,
        refresh_ttl: bool | None = None,
    ) -> list[SearchItem]:
        try:
            return await self._inner.asearch(
                namespace_prefix,
                query=query,
                filter=filter,
                limit=limit,
                offset=offset,
                refresh_ttl=refresh_ttl,
            )
        except _DECODE_ERRORS as exc:
            logger.warning(
                "SafeStore.asearch dropping batch with unparseable row(s) "
                "namespace_prefix=%s offset=%d limit=%d: %s",
                namespace_prefix,
                offset,
                limit,
                exc,
            )
            return []

    def search(
        self,
        namespace_prefix: tuple[str, ...],
        /,
        *,
        query: str | None = None,
        filter: dict[str, Any] | None = None,  # noqa: A002 — mirrors BaseStore signature
        limit: int = 10,
        offset: int = 0,
        refresh_ttl: bool | None = None,
    ) -> list[SearchItem]:
        try:
            return self._inner.search(
                namespace_prefix,
                query=query,
                filter=filter,
                limit=limit,
                offset=offset,
                refresh_ttl=refresh_ttl,
            )
        except _DECODE_ERRORS as exc:
            logger.warning(
                "SafeStore.search dropping batch with unparseable row(s) "
                "namespace_prefix=%s offset=%d limit=%d: %s",
                namespace_prefix,
                offset,
                limit,
                exc,
            )
            return []

    # --- write / namespace passthroughs ----------------------------------
    async def aput(self, *args: Any, **kwargs: Any) -> None:
        return await self._inner.aput(*args, **kwargs)

    def put(self, *args: Any, **kwargs: Any) -> None:
        return self._inner.put(*args, **kwargs)

    async def adelete(self, namespace: tuple[str, ...], key: str) -> None:
        return await self._inner.adelete(namespace, key)

    def delete(self, namespace: tuple[str, ...], key: str) -> None:
        return self._inner.delete(namespace, key)

    async def alist_namespaces(self, **kwargs: Any) -> list[tuple[str, ...]]:
        return await self._inner.alist_namespaces(**kwargs)

    def list_namespaces(self, **kwargs: Any) -> list[tuple[str, ...]]:
        return self._inner.list_namespaces(**kwargs)

    # --- batch (required abstract methods on BaseStore) ------------------
    def batch(self, ops: Any) -> list[Any]:
        return self._inner.batch(ops)

    async def abatch(self, ops: Any) -> list[Any]:
        return await self._inner.abatch(ops)
