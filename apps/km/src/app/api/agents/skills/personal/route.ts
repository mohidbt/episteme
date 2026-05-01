// Personal-skills CRUD. Storage scoped per userId via SkillStore.
//
// GET   /api/agents/skills/personal       — list manifests (auto-seed safe).
// POST  /api/agents/skills/personal       — create new skill from `{name}`,
//                                            auto-slug, empty JSON body.
import { z } from "zod";
import { getSessionInfo } from "@/lib/auth";
import { getSkillStore, defaultSkillBody, parseManifest } from "@/lib/skills-store";
import { toSlug } from "@/lib/slug";

const PostBody = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function GET(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const skills = await getSkillStore().list(session.userId);
    return Response.json({ skills });
  } catch (err) {
    console.error("[skills/personal] list failed", err);
    return Response.json({ error: "list_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const name = parsed.data.name;
  const slug = toSlug(name);
  const json = defaultSkillBody(name);
  try {
    await getSkillStore().write(session.userId, slug, json);
  } catch (err) {
    console.error("[skills/personal] write failed", err);
    return Response.json({ error: "write_failed" }, { status: 500 });
  }
  return Response.json(parseManifest(slug, json));
}