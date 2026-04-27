"""RED test for memory wiring (§1.3b-E2E-4).

Verifies that ``build_km_agent`` wires deepagents' ``CompositeBackend`` so that
``write_file('/memories/...')`` calls persist to the LangGraph store with the
prefix shape the E2E test asserts (``memories:<user_id>``).

Strategy: unit-test the helper that constructs the backend, not the full agent
graph. Calling ``backend.write('/memories/x.md', ...)`` writes via the routed
``StoreBackend`` → the underlying store ends up with namespace ``("memories:<user_id>",)``
and key ``x.md``. That is exactly what the E2E test queries with raw SQL.
"""
from langgraph.store.memory import InMemoryStore


def test_build_memory_backend_writes_under_memories_user_id_prefix():
    """write_file('/memories/x.md', ...) lands in store under prefix 'memories:<user_id>'."""
    from km_agent import _build_memory_backend  # noqa: PLC0415

    store = InMemoryStore()
    backend = _build_memory_backend(user_id="alice", store=store)

    # FilesystemMiddleware calls backend.write(path, content) on write_file.
    # CompositeBackend routes /memories/* to the StoreBackend (with namespace
    # ("memories:alice",)), strips the route prefix, and the StoreBackend
    # persists the result.
    backend.write("/memories/research-interests.md", "photonic computing")

    items = store.search(("memories:alice",))
    keys = [item.key for item in items]
    # deepagents' CompositeBackend strips the route prefix and the StoreBackend
    # persists the remaining absolute path verbatim — so ``/memories/x.md``
    # lands as key ``/x.md`` under prefix ``memories:alice``.
    assert "/research-interests.md" in keys, (
        f"expected key '/research-interests.md' under prefix 'memories:alice'; got {keys}"
    )


def test_build_memory_backend_isolates_users():
    """Two users must not share /memories/ contents."""
    from km_agent import _build_memory_backend  # noqa: PLC0415

    store = InMemoryStore()
    alice_backend = _build_memory_backend(user_id="alice", store=store)
    bob_backend = _build_memory_backend(user_id="bob", store=store)

    alice_backend.write("/memories/secret.md", "alice's data")

    bob_items = store.search(("memories:bob",))
    assert bob_items == [], f"bob should not see alice's memories, got {bob_items}"

    alice_items = store.search(("memories:alice",))
    assert len(alice_items) == 1
    assert alice_items[0].key == "/secret.md"
