"""Print Deep Agents tool/subagent/skill inventory as JSON."""

from __future__ import annotations

import json

from km_agent import _CORE_TOOL_NAMES
from skills import load_skills
from subagents import RESEARCHER_TOOL_NAMES, SYNTHESIZER_TOOL_NAMES, VERIFIER_TOOL_NAMES
from tools import ALL_TOOLS


def main() -> None:
    tool_names = sorted(t.name for t in ALL_TOOLS)
    skills = load_skills(only=[])
    payload = {
        "tool_count": len(tool_names),
        "tools": tool_names,
        "core_tools": sorted(_CORE_TOOL_NAMES),
        "subagents": {
            "researcher": RESEARCHER_TOOL_NAMES,
            "synthesizer": SYNTHESIZER_TOOL_NAMES,
            "verifier": VERIFIER_TOOL_NAMES,
        },
        "skills": [
            {
                "name": s.name,
                "tools": s.tools,
                "subagents": s.subagents,
                "require_approval": s.require_approval,
            }
            for s in skills
        ],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
