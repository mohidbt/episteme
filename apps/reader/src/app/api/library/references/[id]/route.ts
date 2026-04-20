import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { libraryReferences } from "@episteme/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const refId = parseInt(id, 10);
  if (isNaN(refId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const [row] = await db
    .select({ id: libraryReferences.id, userId: libraryReferences.userId })
    .from(libraryReferences)
    .where(eq(libraryReferences.id, refId));

  // Return 404 for both missing rows and ownership mismatches (no existence leak)
  if (!row || row.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(libraryReferences).where(eq(libraryReferences.id, refId));

  return new NextResponse(null, { status: 204 });
}
