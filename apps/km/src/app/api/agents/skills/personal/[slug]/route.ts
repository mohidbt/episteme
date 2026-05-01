// Per-skill mutation: PATCH (update SKILL.md body) and DELETE.
import { z } from "zod";
import { getSessionInfo } from "@/lib/auth";
import { getSkillStore } from "@/lib/skills-store";

const PatchBody = z.object({
  md: z.string(),
});

type Ctx = { params: Promise<{ slug: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await params;
  if (!slug || slug.includes("/")) {
    return Response.json({ error: "invalid_slug" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  try {
    await getSkillStore().write(session.userId, slug, parsed.data.md);
  } catch (err) {
    console.error("[skills/personal/:slug] patch failed", err);
    return Response.json({ error: "write_failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await params;
  if (!slug || slug.includes("/")) {
    return Response.json({ error: "invalid_slug" }, { status: 400 });
  }
  try {
    await getSkillStore().delete(session.userId, slug);
  } catch (err) {
    console.error("[skills/personal/:slug] delete failed", err);
    return Response.json({ error: "delete_failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
