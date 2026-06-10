import { NextResponse } from "next/server";
import { z } from "zod";
import { moveToTrash } from "@/lib/folders-server";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";

const Body = z.object({
  libraryId: z.number().int().positive(),
  target: z.object({
    kind: z.enum(["paper", "reference", "note", "folder", "paperset"]),
    id: z.string().uuid(),
  }),
});

export async function POST(req: Request) {
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError)
      return NextResponse.json({ error: "internal auth misconfigured" }, { status: 500 });
    throw e;
  }
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = authed.userId;

  let json: unknown = null;
  try { json = JSON.parse(rawBody); } catch { /* leave null */ }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  try {
    await moveToTrash({
      libraryId: parsed.data.libraryId,
      userId,
      target: parsed.data.target,
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "error" }, { status: err.status ?? 500 });
  }
}
