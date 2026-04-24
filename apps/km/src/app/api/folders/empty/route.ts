import { NextResponse } from "next/server";
import { z } from "zod";
import { emptyTrash } from "@/lib/folders-server";
import { getUserIdFromRequest } from "@/lib/auth";

const Body = z.object({ libraryId: z.number().int().positive() });

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  try {
    await emptyTrash({ libraryId: parsed.data.libraryId, userId });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "error" }, { status: err.status ?? 500 });
  }
}
