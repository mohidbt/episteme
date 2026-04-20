import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { saveNoteMd } from "@/lib/notes/save-note-md";
import { jsonError } from "@/lib/crud";

const body = z.object({ contentMd: z.string() });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
  if (!row) return jsonError(404, "not_found");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(400, "validation", { issues: parsed.error.issues });
  await saveNoteMd(id, parsed.data.contentMd);
  return new NextResponse(null, { status: 204 });
}
