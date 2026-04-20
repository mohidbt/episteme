import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documents } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";
import { getFile } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const docId = parseInt(id, 10);

  if (isNaN(docId)) {
    return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  }

  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, docId),
        eq(documents.userId, session.user.id) // userId is TEXT — compare as string directly
      )
    )
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await getFile(doc.filePath);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const safeFilename = doc.filename.replace(/[^\x20-\x7E]|["\\]/g, "");

  return new NextResponse(new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), {
    headers: {
      "Content-Disposition": `inline; filename="${safeFilename}"`,
    },
  });
}
