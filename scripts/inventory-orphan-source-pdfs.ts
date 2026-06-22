/**
 * GSD-135: Read-only inventory of papers whose canonical R2 source.pdf is
 * missing. Outputs count + paperIds (one per line) for orchestrator review.
 *
 * No DB writes, no R2 mutations. Always safe to re-run.
 *
 * Usage:
 *   # all users, scan whole papers table
 *   pnpm exec tsx scripts/inventory-orphan-source-pdfs.ts
 *
 *   # one user only
 *   pnpm exec tsx scripts/inventory-orphan-source-pdfs.ts <userId>
 *
 *   # JSON output (one record per orphan)
 *   pnpm exec tsx scripts/inventory-orphan-source-pdfs.ts --json
 *
 * Env: reads DATABASE_URL + S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY. Run
 * from the worktree root with the apps/km .env.local symlinked or sourced.
 *
 * Background: GSD-132 post-deploy E2E caught papers/[id]/outline and
 * papers/[id]/auto-highlight returning 500 with
 * `[Errno 2] No such file or directory: '<paperId>/source.pdf'`. Either
 * ingest dropped the upload or R2 lifecycle reaped it. This script
 * identifies affected paperIds — DELETION/RE-INGEST policy is left to
 * the orchestrator.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@episteme/db";
import { papers } from "@episteme/db/schema";
import { createStorage } from "@episteme/storage";

type Orphan = {
  paperId: string;
  userId: string;
  filename: string;
  storageUrl: string | null;
  addedAt: Date;
};

function paperSourceKey(id: string): string {
  return `${id}/source.pdf`;
}

function buildStorage() {
  const env = (k: string, d?: string) => process.env[k] ?? d;
  return createStorage({
    endpoint: env("S3_ENDPOINT", "http://localhost:9000")!,
    bucket: env("S3_BUCKET", "episteme-dev")!,
    accessKey: env("S3_ACCESS_KEY", "episteme")!,
    secretKey: env("S3_SECRET_KEY", "episteme-dev")!,
    region: env("S3_REGION", "us-east-1"),
    forcePathStyle: true,
  });
}

async function inventory(filterUserId?: string): Promise<Orphan[]> {
  const storage = buildStorage();
  const rows = await db
    .select({
      id: papers.id,
      userId: papers.userId,
      filename: papers.filename,
      storageUrl: papers.storageUrl,
      addedAt: papers.addedAt,
    })
    .from(papers)
    .where(filterUserId ? eq(papers.userId, filterUserId) : sql`TRUE`);

  console.error(`[inventory] scanning ${rows.length} papers...`);

  const orphans: Orphan[] = [];
  let checked = 0;
  for (const row of rows) {
    const key = row.storageUrl ?? paperSourceKey(row.id);
    let exists = false;
    try {
      exists = await storage.objectExists(key);
    } catch (err) {
      console.error(
        `[inventory] HEAD failed for ${row.id} (key=${key}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Treat unknown error as "not orphan" — bias toward false negatives so
      // we don't act on transient S3 errors as if the object were missing.
      continue;
    }
    if (!exists) {
      orphans.push({
        paperId: row.id,
        userId: row.userId,
        filename: row.filename,
        storageUrl: row.storageUrl,
        addedAt: row.addedAt,
      });
    }
    checked++;
    if (checked % 100 === 0) {
      console.error(`[inventory] progress: ${checked}/${rows.length}`);
    }
  }

  return orphans;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const userId = args.find((a) => !a.startsWith("--"));

  const orphans = await inventory(userId);

  console.error(`[inventory] done — orphans=${orphans.length}`);

  if (jsonMode) {
    process.stdout.write(JSON.stringify(orphans, null, 2) + "\n");
  } else {
    for (const o of orphans) {
      // user-facing one-per-line summary for grep-ability
      process.stdout.write(
        `${o.paperId}\tuser=${o.userId}\tfilename=${o.filename}\tstorage=${
          o.storageUrl ?? "(null)"
        }\n`,
      );
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
