"""Scenario 8 — wraps scripts/check-skill-addition.ts as a pytest.

Independent of the live agents service: the script spawns its own uvicorn.
"""
from __future__ import annotations

import pathlib
import subprocess


def test_scalability_gate_exits_zero():
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    worktree = repo_root / ".claude" / "worktrees" / "1.3b-agents"
    tsx_bin = str(worktree / "node_modules" / ".bin" / "tsx")
    result = subprocess.run(
        [tsx_bin, "scripts/check-skill-addition.ts"],
        cwd=str(worktree),
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, f"\nstdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
    assert "scalability gate held" in result.stdout
