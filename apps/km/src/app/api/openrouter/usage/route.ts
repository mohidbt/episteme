// Round C — read-side aggregate. Returns the active identity's 30-day
// OpenRouter spend, per-model breakdown, and the appropriate soft limit.
// Soft warn only; never blocks calls.

import { getSessionInfo } from "@/lib/auth";
import {
  getRecentSpendUsd,
  OR_GUEST_SOFT_LIMIT_USD,
  OR_USER_SOFT_LIMIT_USD,
} from "@/lib/openrouter-usage";

export async function GET(req: Request) {
  const session = await getSessionInfo(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Identity rule mirrors recordUsage: anonymous → guest id, signed-in →
  // user id. The "guest id" we use is the anon user.id (better-auth gives
  // every anon user a stable id), so the audit trail is consistent across
  // a guest's session.
  const isGuest = session.isAnonymous;
  const userId = isGuest ? null : session.userId;
  const guestId = isGuest ? session.userId : null;

  const { totalUsd, byModel } = await getRecentSpendUsd(userId, guestId);
  const limitUsd = isGuest ? OR_GUEST_SOFT_LIMIT_USD : OR_USER_SOFT_LIMIT_USD;

  return Response.json({ totalUsd, byModel, isGuest, limitUsd });
}
