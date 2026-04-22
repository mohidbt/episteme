import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { isValidUsername } from "@/lib/username";
import { jsonError } from "@/lib/crud";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const name = typeof body?.username === "string" ? body.username : null;
  if (!name || !isValidUsername(name)) return jsonError(400, "validation");

  try {
    await db.update(user).set({ username: name }).where(eq(user.id, userId));
  } catch (err: unknown) {
    const code =
      (err as { code?: string })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") return Response.json({ error: "taken" }, { status: 409 });
    throw err;
  }
  return Response.json({ username: name });
}
