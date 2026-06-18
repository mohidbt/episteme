// GSD-126 P0 — ad-hoc parity check between OR-side and local-side usage.
//
// Usage:
//   tsx apps/km/scripts/verify-or-bucket-parity.ts --user-id=USER_ID
//
// Requires:
//   - DATABASE_URL pointing at the env you want to inspect (prod read-only OK).
//   - OPENROUTER_PROVISIONING_KEY for the matching OR org.
//
// Prints:
//   user_id, or_key_hash, OR-reported usage, local sum, diff, within-tolerance verdict.

import { db } from "@/lib/db";
import { userOpenrouterKeys, openrouterUsage } from "@episteme/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { getUserBucketUsage } from "@/lib/openrouter-provisioning";

function parseArgs(): { userId: string } {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? ""];
    }),
  );
  const userId = args["user-id"];
  if (!userId) {
    console.error("Usage: tsx scripts/verify-or-bucket-parity.ts --user-id=USER_ID");
    process.exit(1);
  }
  return { userId };
}

async function main() {
  const { userId } = parseArgs();
  const [bucket] = await db
    .select({
      hash: userOpenrouterKeys.orKeyHash,
      createdAt: userOpenrouterKeys.createdAt,
    })
    .from(userOpenrouterKeys)
    .where(eq(userOpenrouterKeys.userId, userId))
    .limit(1);
  if (!bucket) {
    console.error(`No managed bucket row for user ${userId}`);
    process.exit(2);
  }

  const orResp = await getUserBucketUsage(bucket.hash);
  const localRows = await db
    .select({ costUsd: openrouterUsage.costUsd })
    .from(openrouterUsage)
    .where(
      and(
        eq(openrouterUsage.userId, userId),
        gte(openrouterUsage.createdAt, bucket.createdAt),
      ),
    );
  const localSum = localRows.reduce((acc, r) => acc + Number(r.costUsd), 0);

  const diff = Math.abs(orResp.usageUsd - localSum);
  const tolerance = Math.max(0.001, orResp.usageUsd * 0.05);
  const ok = diff <= tolerance;

  console.log(
    JSON.stringify(
      {
        userId,
        hash: bucket.hash,
        orUsageUsd: orResp.usageUsd,
        localUsageUsd: localSum,
        diffUsd: diff,
        toleranceUsd: tolerance,
        withinTolerance: ok,
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
