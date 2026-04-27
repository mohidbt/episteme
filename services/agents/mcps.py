"""MCP server config loader.

`mcps.yaml` ships in this directory and lists external MCP servers the
researcher subagent may attach to. Each entry:

```yaml
- name: arxiv          # required; used as adapter key + tool prefix
  transport: sse        # 'sse' or 'stdio'
  url: https://...      # required for sse; must be a valid http(s) URL
  command: npx          # required for stdio
  args: [...]           # optional, stdio
  enabled: true         # disabled entries are skipped
```

`load_mcp_servers()` validates and returns a list of `MCPServerSpec`.
`load_mcp_tools(only=...)` connects to each enabled server via
langchain-mcp-adapters and returns the resulting LangChain tools. Connection
errors are swallowed with a logged warning so the agent boots even when MCP
servers are unreachable in dev.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml
from langchain_core.tools import BaseTool

try:
    # langchain-mcp-adapters is a soft dep — researcher works without it.
    from langchain_mcp_adapters.client import MultiServerMCPClient  # type: ignore
except Exception:  # pragma: no cover - import failure path
    MultiServerMCPClient = None  # type: ignore

logger = logging.getLogger(__name__)

MCPS_YAML_PATH = Path(__file__).resolve().parent / "mcps.yaml"

_VALID_TRANSPORTS = {"sse", "stdio"}


@dataclass
class MCPServerSpec:
    """A validated MCP server entry from `mcps.yaml`."""

    name: str
    transport: str
    enabled: bool = True
    url: str | None = None
    command: str | None = None
    args: list[str] = field(default_factory=list)
    tool_prefix: str | None = None


def _validate(entry: dict[str, Any]) -> MCPServerSpec:
    if "name" not in entry or not entry["name"]:
        raise ValueError(f"MCP entry missing 'name': {entry}")
    name = str(entry["name"])

    transport = str(entry.get("transport", "sse"))
    if transport not in _VALID_TRANSPORTS:
        raise ValueError(
            f"MCP entry '{name}' has unknown transport '{transport}' "
            f"(expected one of {sorted(_VALID_TRANSPORTS)})"
        )

    url = entry.get("url")
    if transport == "sse":
        if not url:
            raise ValueError(f"MCP entry '{name}' (sse) missing 'url'")
        parsed = urlparse(str(url))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(
                f"MCP entry '{name}' has invalid url '{url}' — expected http(s)://host/..."
            )

    command = entry.get("command")
    if transport == "stdio" and not command:
        raise ValueError(f"MCP entry '{name}' (stdio) missing 'command'")

    return MCPServerSpec(
        name=name,
        transport=transport,
        enabled=bool(entry.get("enabled", True)),
        url=str(url) if url else None,
        command=str(command) if command else None,
        args=[str(a) for a in (entry.get("args") or [])],
        tool_prefix=str(entry["tool_prefix"]) if entry.get("tool_prefix") else None,
    )


def load_mcp_servers(path: Path | None = None) -> list[MCPServerSpec]:
    """Parse + validate `mcps.yaml`.

    Raises `ValueError` on the first malformed entry.
    Returns [] if the file is absent.
    """
    p = path or MCPS_YAML_PATH
    if not p.exists():
        return []
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError(f"{p}: top-level must be a list of MCP entries")
    return [_validate(entry) for entry in raw]


def _to_connection(spec: MCPServerSpec) -> dict[str, Any]:
    """Translate an `MCPServerSpec` to the dict shape expected by
    `MultiServerMCPClient`'s `connections` kwarg.
    """
    if spec.transport == "sse":
        return {"transport": "sse", "url": spec.url}
    return {"transport": "stdio", "command": spec.command, "args": spec.args}


async def load_mcp_tools(only: list[str] | None = None) -> list[BaseTool]:
    """Connect to enabled MCP servers and return their LangChain tools.

    Args:
        only: If provided, only servers whose `name` is in this list are loaded.
            Pass an empty list to load nothing. Pass `None` to load all enabled.

    Connection / import errors are logged and swallowed so the agent still
    boots. The caller may receive [] when nothing is reachable.
    """
    servers = load_mcp_servers()
    enabled = [s for s in servers if s.enabled]
    if only is not None:
        wanted = set(only)
        enabled = [s for s in enabled if s.name in wanted]
    if not enabled:
        return []

    if MultiServerMCPClient is None:
        logger.warning(
            "langchain-mcp-adapters not importable; skipping %d MCP server(s)",
            len(enabled),
        )
        return []

    connections = {s.name: _to_connection(s) for s in enabled}
    try:
        client = MultiServerMCPClient(connections=connections)
        tools = await client.get_tools()
    except Exception as exc:  # noqa: BLE001 - resilient by design
        logger.warning("Failed to load MCP tools (%s) — continuing without them", exc)
        return []
    return list(tools or [])


__all__ = [
    "MCPS_YAML_PATH",
    "MCPServerSpec",
    "MultiServerMCPClient",
    "load_mcp_servers",
    "load_mcp_tools",
]
