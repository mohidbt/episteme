// GSD-96 R3 — touch helper for the recents source backing the @-picker.
//
// Upserts a (user, kind, item) row in user_library_recents w/ opened_at=now()
// then trims the user's rows to the 50 most-recent (cheap, idempotent).
// Default contract is fire-and-forget from server components: pass
// swallow=true to suppress DB errors so the parent page render never fails.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const VALID_KINDS = new Set(["paper", "note", "reference", "paperset"] as const);
type Kind = "paper" | "note" | "reference" | "paperset";

export interface TouchRecentArgs {
  userId: string;
  kind: Kind;
  itemId: string;
  /** Swallow DB errors instead of throwing (fire-and-forget). */
  swallow?: boolean;
}

const MAX_ROWS_PER_USER = 50;

export async function touchRecent(args: TouchRecentArgs): Promise<void> {
  if (!VALID_KINDS.has(args.kind)) {
    throw new Error(`invalid kind: ${args.kind}`);
  }
  try {
    await db.execute(sql`
      INSERT INTO user_library_recents (user_id, kind, item_id, opened_at)
      VALUES (${args.userId}, ${args.kind}, ${args.itemId}, now())
      ON CONFLICT (user_id, kind, item_id) DO UPDATE SET opened_at = now()
    `);
    await db.execute(sql`
      DELETE FROM user_library_recents
      WHERE user_id = ${args.userId}
        AND (kind, item_id) NOT IN (
          SELECT kind, item_id FROM user_library_recents
          WHERE user_id = ${args.userId}
          ORDER BY opened_at DESC
          LIMIT ${MAX_ROWS_PER_USER}
        )
    `);
  } catch (err) {
    if (args.swallow) return;
    throw err;
  }
}
