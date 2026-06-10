import { NextResponse } from "next/server";
import { z } from "zod";
import { moveFolder } from "@/lib/folders-server";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";

const Body = z.object({
  folderId: z.string().uuid(),
  targetParentId: z.string().uuid().nullable(),
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
    await moveFolder({
      folderId: parsed.data.folderId,
      userId,
      targetParentId: parsed.data.targetParentId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "error" }, { status: err.status ?? 500 });
  }
}
