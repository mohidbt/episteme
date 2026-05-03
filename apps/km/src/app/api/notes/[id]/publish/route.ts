import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { notes, user } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError } from "@/lib/crud";
import { toSlug } from "@/lib/slug";

const publishBody = z.object({
  isPublic: z.boolean(),
  publicSlug: z.string().min(1).max(200).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Dual-auth: cookie session OR HMAC (used by agent `make_public` tool).
  // Read raw body once and pass to HMAC verifier (sig covers ts+method+path+body).
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;

  let bodyJson: unknown = null;
  try { bodyJson = JSON.parse(rawBody); } catch { /* leave null */ }
  const parsed = publishBody.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonError(400, "validation", { issues: parsed.error.issues });
  }

  const [noteRow] = await db
    .select({ slug: notes.slug })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
  if (!noteRow) return jsonError(404, "not_found");

  if (!parsed.data.isPublic) {
    await db
      .update(notes)
      .set({ isPublic: false, publicSlug: null })
      .where(eq(notes.id, id));
    return Response.json({ isPublic: false, publicSlug: null });
  }

  const [u] = await db
    .select({ username: user.username })
    .from(user)
    .where(eq(user.id, userId));
  if (!u?.username) {
    return Response.json({ error: "set_username_first" }, { status: 400 });
  }

  const publicSlug = (parsed.data.publicSlug ?? noteRow.slug).trim();
  if (!publicSlug || toSlug(publicSlug) !== publicSlug) {
    return jsonError(400, "validation");
  }

  try {
    await db
      .update(notes)
      .set({ isPublic: true, publicSlug })
      .where(eq(notes.id, id));
  } catch (err: unknown) {
    const code =
      (err as { code?: string })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      return Response.json({ error: "slug_taken" }, { status: 409 });
    }
    throw err;
  }

  return Response.json({ isPublic: true, publicSlug });
}
