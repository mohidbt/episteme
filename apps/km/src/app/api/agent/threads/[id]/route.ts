import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionInfo } from "@/lib/auth";
import { deleteThread, getThread, updateThread } from "@/lib/threads";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionInfo(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const thread = await getThread(session.userId, id);
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread });
}

const PatchBody = z.object({
  title: z.string().min(1).max(500).nullable().optional(),
  modelOverride: z.string().min(1).max(200).nullable().optional(),
  status: z.enum(["idle", "running", "awaiting_hitl", "error"]).optional(),
  skill: z.string().min(1).max(100).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionInfo(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const thread = await updateThread(session.userId, id, parsed.data);
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionInfo(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteThread(session.userId, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
