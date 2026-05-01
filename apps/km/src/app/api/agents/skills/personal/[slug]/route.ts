// Per-skill read + mutation: GET (fetch skill JSON), PATCH (update), DELETE.
import { z } from "zod";
import { getSessionInfo } from "@/lib/auth";
import { getSkillStore, type SkillJson } from "@/lib/skills-store";

const PatchBody = z.object({
  description: z.string().optional(),
  instructions: z.string().optional(),
});

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await params;
  if (!slug || slug.includes("/")) {
    return Response.json({ error: "invalid_slug" }, { status: 400 });
  }
  let content: string;
  try {
    content = await getSkillStore().read(session.userId, slug);
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  let skill: SkillJson;
  try {
    skill = JSON.parse(content) as SkillJson;
  } catch {
    skill = { name: slug, description: "", instructions: "" };
  }
  return Response.json({ slug, ...skill });
}

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

  // Read-merge-write: load existing, overlay patch fields, write back.
  let existing: SkillJson;
  try {
    const content = await getSkillStore().read(session.userId, slug);
    existing = JSON.parse(content) as SkillJson;
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const merged: SkillJson = {
    name: existing.name,
    description: parsed.data.description ?? existing.description,
    instructions: parsed.data.instructions ?? existing.instructions,
  };

  try {
    await getSkillStore().write(session.userId, slug, JSON.stringify(merged, null, 2));
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