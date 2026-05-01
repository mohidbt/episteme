// GET /api/agents/skills — merged list of system + personal skills.
//
// System skills are the canonical built-ins (shipped with the agents service
// and mirrored in `@/lib/skills`). Personal skills are user-authored SKILL.md
// files in MinIO under `skills/users/<userId>/<slug>/SKILL.md`.
//
// We merge so writing-tagged personal skills surface in the inline AI
// rephrase picker alongside the canonical Synthesis skill, without forcing
// every consumer to learn about `/personal`.
import { getSessionInfo } from "@/lib/auth";
import { SKILLS } from "@/lib/skills";
import { getSkillStore, type SkillManifest } from "@/lib/skills-store";

export async function GET(req: Request) {
  // Map system skills onto the same shape as personal manifests so consumers
  // (AiBubbleMenu, settings) can treat the merged list uniformly. We keep
  // `instruction` on system entries because the bubble-menu rephrase prompt
  // depends on it; personal skills don't have one yet.
  const system = SKILLS.map((s) => ({
    name: s.name,
    title: s.title,
    description: s.description,
    instruction: s.instruction,
    category: s.category,
    source: "system" as const,
  }));

  const session = await getSessionInfo(req);
  let personal: Array<SkillManifest & { source: "personal" }> = [];
  if (session) {
    try {
      const list = await getSkillStore().list(session.userId);
      personal = list.map((m) => ({ ...m, source: "personal" as const }));
    } catch (err) {
      console.warn("[skills] personal list failed", err);
    }
  }

  return Response.json({ skills: [...system, ...personal] });
}
