import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@episteme/db/schema";
import { isReservedUsername, isValidUsername } from "@/lib/username";

// Public availability pre-check for the signup wizard. Echoes only
// coarse reason categories — no PII, no row data.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("u")?.toLowerCase().trim() ?? "";
  if (!raw) {
    return Response.json({ available: false, reason: "invalid" });
  }
  if (isReservedUsername(raw)) {
    return Response.json({ available: false, reason: "reserved" });
  }
  if (!isValidUsername(raw)) {
    return Response.json({ available: false, reason: "invalid" });
  }

  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.username})`, raw))
    .limit(1);

  if (rows.length > 0) {
    return Response.json({ available: false, reason: "taken" });
  }
  return Response.json({ available: true });
}
