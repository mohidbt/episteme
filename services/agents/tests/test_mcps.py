"""Tests for the MCP server config loader + tool loader.

`mcps.yaml` defines a list of MCP server connection specs. The loader:
- Validates each entry (name required, sse → url required and well-formed,
  stdio → command required).
- Skips disabled entries.
- `load_mcp_tools(only=...)` connects to enabled servers via
  langchain-mcp-adapters and returns BaseTool instances. Connection errors
  are swallowed with a logged warning so the agent still boots.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from mcps import load_mcp_servers, load_mcp_tools


def _write_yaml(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "mcps.yaml"
    p.write_text(content, encoding="utf-8")
    return p


# ---------------------------------------------------------------- validation

def test_load_servers_parses_well_formed_sse(tmp_path: Path):
    p = _write_yaml(tmp_path, """
- name: arxiv
  transport: sse
  url: https://arxiv-mcp.example.com/sse
  enabled: true
- name: pubmed
  transport: sse
  url: https://pubmed-mcp.example.com/sse
  enabled: false
""")
    servers = load_mcp_servers(path=p)
    assert len(servers) == 2
    assert servers[0].name == "arxiv"
    assert servers[0].transport == "sse"
    assert servers[0].enabled is True
    assert servers[1].enabled is False


def test_load_servers_parses_well_formed_stdio(tmp_path: Path):
    p = _write_yaml(tmp_path, """
- name: firecrawl
  transport: stdio
  command: npx
  args: ["-y", "firecrawl-mcp"]
  enabled: true
""")
    servers = load_mcp_servers(path=p)
    assert len(servers) == 1
    s = servers[0]
    assert s.transport == "stdio"
    assert s.command == "npx"
    assert s.args == ["-y", "firecrawl-mcp"]


def test_load_servers_rejects_missing_name(tmp_path: Path):
    p = _write_yaml(tmp_path, """
- transport: sse
  url: https://example.com/sse
""")
    with pytest.raises(ValueError, match="name"):
        load_mcp_servers(path=p)


def test_load_servers_rejects_bad_url(tmp_path: Path):
    p = _write_yaml(tmp_path, """
- name: arxiv
  transport: sse
  url: not-a-url
""")
    with pytest.raises(ValueError, match="url"):
        load_mcp_servers(path=p)


def test_load_servers_rejects_stdio_without_command(tmp_path: Path):
    p = _write_yaml(tmp_path, """
- name: bad
  transport: stdio
""")
    with pytest.raises(ValueError, match="command"):
        load_mcp_servers(path=p)


def test_load_servers_rejects_unknown_transport(tmp_path: Path):
    p = _write_yaml(tmp_path, """
- name: bad
  transport: smoke-signal
""")
    with pytest.raises(ValueError, match="transport"):
        load_mcp_servers(path=p)


# ---------------------------------------------------------------- tool loader

@pytest.mark.asyncio
async def test_load_tools_skips_disabled_entries(tmp_path: Path, monkeypatch):
    p = _write_yaml(tmp_path, """
- name: arxiv
  transport: sse
  url: https://arxiv.example.com/sse
  enabled: false
""")
    monkeypatch.setattr("mcps.MCPS_YAML_PATH", p)
    tools = await load_mcp_tools(only=["arxiv"])
    assert tools == []


@pytest.mark.asyncio
async def test_load_tools_returns_empty_when_only_filter_excludes_all(tmp_path: Path, monkeypatch):
    p = _write_yaml(tmp_path, """
- name: arxiv
  transport: sse
  url: https://arxiv.example.com/sse
  enabled: true
""")
    monkeypatch.setattr("mcps.MCPS_YAML_PATH", p)
    tools = await load_mcp_tools(only=["pubmed"])
    assert tools == []


@pytest.mark.asyncio
async def test_load_tools_swallows_connection_errors(tmp_path: Path, monkeypatch):
    """If MCP servers are unreachable we log + return [] — never raise."""
    p = _write_yaml(tmp_path, """
- name: arxiv
  transport: sse
  url: https://127.0.0.1:1/does-not-exist
  enabled: true
""")
    monkeypatch.setattr("mcps.MCPS_YAML_PATH", p)
    # Should not raise even though the URL is unreachable.
    tools = await load_mcp_tools(only=["arxiv"])
    assert tools == []


@pytest.mark.asyncio
async def test_load_tools_uses_mocked_client(tmp_path: Path, monkeypatch):
    """When the adapter client is mocked to return tools, they pass through."""
    from langchain_core.tools import tool

    @tool("arxiv_search")
    def stub(query: str) -> str:  # noqa: ARG001
        """Stub."""
        return ""

    p = _write_yaml(tmp_path, """
- name: arxiv
  transport: sse
  url: https://arxiv.example.com/sse
  enabled: true
""")
    monkeypatch.setattr("mcps.MCPS_YAML_PATH", p)

    class _StubClient:
        def __init__(self, *args, **kwargs):
            pass
        async def get_tools(self, *, server_name=None):
            return [stub]

    monkeypatch.setattr("mcps.MultiServerMCPClient", _StubClient)
    tools = await load_mcp_tools(only=["arxiv"])
    assert [t.name for t in tools] == ["arxiv_search"]


# ---------------------------------------------------------------- bundled file

def test_default_mcps_yaml_parses():
    """The shipped mcps.yaml must be parseable (stub entries OK)."""
    from mcps import MCPS_YAML_PATH
    if not MCPS_YAML_PATH.exists():
        pytest.skip("mcps.yaml not yet shipped")
    servers = load_mcp_servers()
    # Must include the four canonical research MCP names.
    names = {s.name for s in servers}
    assert {"arxiv", "biorxiv", "pubmed"}.issubset(names)
