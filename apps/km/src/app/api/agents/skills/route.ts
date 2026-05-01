// GET /api/agents/skills — merged list of system + personal skills.
//
// System skills are the canonical built-ins (shipped with the agents service
// and mirrored in `@/lib/skills`). Personal skills are user-authored JSON
// files in MinIO under `skills/users/<userId>/<slug>/SKILL.json`.
//
// We merge so writing-tagged system skills and all personal skills surface
// in the inline AI rephrase picker. Personal skills use their `description`
// as the display label and `instructions` as the rephrase prompt.
import { getSessionInfo } from "@/lib/auth";
import { SKILLS } from "@/lib/skills";
import { getSkillStore, type SkillManifest } from "@/lib/skills-store";

export async function GET(req: Request) {
  const system = SKILLS.map((s) => ({
    name: s.name,
    title: s.title,
    description: s.description,
    instruction: s.instruction,
    category: s.category,
    source: "system" as const,
  }));

  const session = await getSessionInfo(req);
  let personal: Array<SkillManifest & { source: "personal"; instruction: string }> = [];
  if (session) {
    try {
      const list = await getSkillStore().list(session.userId);
      personal = list.map((m) => ({
        ...m,
        source: "personal" as const,
        // Personal skills use their instructions as the rephrase prompt.
        // Falls back to description if instructions are empty.
        instruction: m.instructions || m.description,
      }));
    } catch (err) {
      console.warn("[skills] personal list failed", err);
    }
  }

  return Response.json({ skills: [...system, ...personal] });
}