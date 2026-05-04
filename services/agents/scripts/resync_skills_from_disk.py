#!/usr/bin/env python3
"""Force-resync user drive SKILL notes from disk SKILL.md templates.

Why this exists
---------------
``services/agents/skills/drive_loader.py`` seeds disk ``SKILL.md`` files
into the user's drive on first load (one note per skill, in folder
``.episteme/agents/skills/<name>``). After seeding, the drive copy is the
source of truth — agent builds read from the drive, never from disk.

That means when we edit a disk template (e.g. add a new tool to deep-read's
allow-list), every existing user's drive copy stays stale. The new tool is
invisible to their agent until something rewrites the drive note.

This script overwrites the drive note for the named user and skill from the
current on-disk template. Use sparingly — it clobbers any user edits to
that drive note.

Usage
-----
    cd services/agents
    DATABASE_URL=postgresql://... \\
      uv run python scripts/resync_skills_from_disk.py \\
        --user XrC7P8lmROSz03yk8hcwR9VNWXkFjjJL \\
        --skill deep-read

Add ``--all-skills`` to resync every disk skill for that user. Add
``--all-users`` to resync the named skill for every user who already has it.

Both ``--all-*`` flags require explicit confirmation via ``--yes``.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

SKILLS_ROOT = Path(__file__).resolve().parent.parent / "skills"


def _disk_skill_md(name: str) -> str | None:
    p = SKILLS_ROOT / name / "SKILL.md"
    if not p.is_file():
        return None
    return p.read_text(encoding="utf-8")


def _disk_skill_names() -> list[str]:
    if not SKILLS_ROOT.is_dir():
        return []
    return sorted(
        c.name
        for c in SKILLS_ROOT.iterdir()
        if c.is_dir() and not c.name.startswith(("_", "."))
        and (c / "SKILL.md").is_file()
    )


def _resync_one(conn, user_id: str, skill_name: str, content_md: str) -> str:
    """Overwrite the SKILL note for ``user_id`` + ``skill_name``. Returns status."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT n.id
              FROM notes n
              JOIN folders f ON n.folder_id = f.id
             WHERE n.user_id = %s
               AND n.title = 'SKILL'
               AND f.name = %s
            """,
            (user_id, skill_name),
        )
        row = cur.fetchone()
        if not row:
            return f"skip {skill_name}: no drive note"
        note_id = row[0]
        cur.execute(
            "UPDATE notes SET content_md = %s, updated_at = now() WHERE id = %s",
            (content_md, note_id),
        )
    return f"resynced {skill_name} (note {note_id})"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user", help="User id (skip when --all-users)")
    p.add_argument("--skill", help="Skill name (skip when --all-skills)")
    p.add_argument("--all-skills", action="store_true", help="Resync every disk skill for the user")
    p.add_argument("--all-users", action="store_true", help="Resync the skill for every user who already has it")
    p.add_argument("--yes", action="store_true", help="Confirm bulk operations")
    args = p.parse_args()

    if args.all_skills and args.all_users:
        print("error: --all-skills and --all-users are mutually exclusive", file=sys.stderr)
        return 2
    if (args.all_skills or args.all_users) and not args.yes:
        print("error: bulk operations require --yes", file=sys.stderr)
        return 2

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("error: DATABASE_URL not set", file=sys.stderr)
        return 2

    if args.all_skills:
        if not args.user:
            print("error: --user required (or use --all-users for the inverse)", file=sys.stderr)
            return 2
        skill_names = _disk_skill_names()
    else:
        if not args.skill:
            print("error: --skill required", file=sys.stderr)
            return 2
        skill_names = [args.skill]

    with psycopg.connect(db_url) as conn:
        if args.all_users:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT n.user_id
                      FROM notes n
                      JOIN folders f ON n.folder_id = f.id
                     WHERE n.title = 'SKILL' AND f.name = %s
                    """,
                    (args.skill,),
                )
                user_ids = [r[0] for r in cur.fetchall()]
            print(f"resyncing {args.skill} for {len(user_ids)} users")
        elif args.user:
            user_ids = [args.user]
        else:
            print("error: --user or --all-users required", file=sys.stderr)
            return 2

        for uid in user_ids:
            for sn in skill_names:
                content = _disk_skill_md(sn)
                if content is None:
                    print(f"skip {sn}: no disk template")
                    continue
                print(_resync_one(conn, uid, sn, content))
        conn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
