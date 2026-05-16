/**
 * One-shot backfill: populate `papers.size_bytes` for legacy rows still at 0.
 *
 * Migration 0033 (`0033_size_bytes_papers_notes.sql`) added the column with
 * default 0 for existing rows. The authoritative byte count lives on
 * R2/MinIO, so we HEAD each `storage_url` key and write Content-Length back.
 *
 * Usage:
 *   pnpm --filter @episteme/db tsx scripts/backfill_papers_size_bytes.ts
 *     # or via the package.json script:
 *   pnpm --filter @episteme/db db:backfill-papers-size
 *
 * Env (required):
 *   OWNER_DATABASE_URL or MIGRATE_DATABASE_URL — Postgres DSN with UPDATE on `papers`.
 *     `papers` is a legacy table owned by `neondb_owner`; UPDATE works for any
 *     role with table-level UPDATE grant (migrate_only has it). Prefer
 *     OWNER_DATABASE_URL for the smallest blast radius.
 *   S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION — R2/MinIO creds.
 *
 * Behaviour:
 *   - Idempotent: re-runnable. Selects only rows where `size_bytes = 0` AND
 *     `storage_url IS NOT NULL` (skips in-flight imports).
 *   - On HEAD 404 / any error: logs warn, skips the row, continues.
 *   - Concurrency 5 via inline limiter; progress every 100 rows.
 *
 * SAFETY: this script writes to the DB. Do not run against prod without a
 * dry-run review of candidate count first.
 */

// NB: `postgres` and `@aws-sdk/client-s3` are loaded lazily inside `main()` so
// that the unit test can import `runBackfill` without dragging in S3 SDK
// (which is not a direct dep of @episteme/db; it's pulled via @episteme/storage
// in the app at runtime).

export interface HeadResult {
  contentLength: number;
}

export interface BackfillDeps {
  selectCandidates: () => Promise<Array<{ id: string; storage_url: string }>>;
  updateSize: (id: string, sizeBytes: number) => Promise<void>;
  head: (key: string) => Promise<HeadResult>;
  concurrency: number;
  progressEvery: number;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
}

/**
 * Minimal inline concurrency limiter. Avoids a runtime dep on `p-limit`
 * (only present as a transitive in pnpm-lock.yaml today).
 */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (v) => {
            active--;
            resolve(v);
            next();
          },
          (e) => {
            active--;
            reject(e);
            next();
          },
        );
      };
      queue.push(run);
      next();
    });
  };
}

export async function runBackfill(
  deps: BackfillDeps,
): Promise<BackfillResult> {
  const candidates = await deps.selectCandidates();
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const limit = createLimiter(deps.concurrency);

  const tasks = candidates.map((row) =>
    limit(async () => {
      scanned++;
      try {
        const { contentLength } = await deps.head(row.storage_url);
        if (!Number.isFinite(contentLength) || contentLength < 0) {
          console.warn(
            `[backfill] paper=${row.id} key=${row.storage_url} bad Content-Length=${contentLength}; skipping`,
          );
          skipped++;
        } else {
          await deps.updateSize(row.id, contentLength);
          updated++;
        }
      } catch (err) {
        console.warn(
          `[backfill] paper=${row.id} key=${row.storage_url} HEAD failed: ${
            (err as Error).message ?? err
          }; skipping`,
        );
        skipped++;
      }
      if (scanned % deps.progressEvery === 0) {
        console.log(
          `[backfill] progress: scanned=${scanned} updated=${updated} skipped=${skipped}`,
        );
      }
    }),
  );

  await Promise.all(tasks);
  return { scanned, updated, skipped };
}

/**
 * Wire deps for a real run: pg client + S3 HEAD.
 */
async function main() {
  const dsn = process.env.OWNER_DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL;
  if (!dsn) {
    console.error(
      "[backfill] OWNER_DATABASE_URL (or MIGRATE_DATABASE_URL) required",
    );
    process.exit(1);
  }

  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (!bucket || !endpoint || !accessKey || !secretKey) {
    console.error(
      "[backfill] S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY required",
    );
    process.exit(1);
  }

  // Dynamic imports keep the test surface free of S3/postgres at module load.
  // Typed as `any` because `@aws-sdk/client-s3` is not a direct dep of @episteme/db
  // (it's pulled via @episteme/storage in the app). `tsx` resolves it at runtime
  // through the workspace hoist.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: postgres } = (await import("postgres")) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { S3Client, HeadObjectCommand } = (await import(
    // @ts-expect-error — not a direct dep; resolved via workspace at runtime
    "@aws-sdk/client-s3"
  )) as any;

  const sql = postgres(dsn);
  const s3 = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const BATCH = 20;
  let lastId: string | null = null;
  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  while (true) {
    // Cursor-paginated SELECT — keeps memory flat even on large libraries.
    const rows: Array<{ id: string; storage_url: string }> = lastId
      ? await sql`
          SELECT id, storage_url FROM papers
          WHERE size_bytes = 0
            AND storage_url IS NOT NULL
            AND id > ${lastId}
          ORDER BY id ASC
          LIMIT ${BATCH}
        `
      : await sql`
          SELECT id, storage_url FROM papers
          WHERE size_bytes = 0
            AND storage_url IS NOT NULL
          ORDER BY id ASC
          LIMIT ${BATCH}
        `;
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    const result = await runBackfill({
      selectCandidates: async () =>
        rows.map((r) => ({ id: r.id, storage_url: r.storage_url })),
      updateSize: async (id, sizeBytes) => {
        await sql`UPDATE papers SET size_bytes = ${sizeBytes} WHERE id = ${id} AND size_bytes = 0`;
      },
      head: async (key) => {
        const out = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        const cl = out.ContentLength;
        if (typeof cl !== "number") {
          throw new Error(`missing Content-Length for key=${key}`);
        }
        return { contentLength: cl };
      },
      concurrency: 5,
      progressEvery: 100,
    });
    totalScanned += result.scanned;
    totalUpdated += result.updated;
    totalSkipped += result.skipped;
  }

  console.log(
    `[backfill] DONE scanned=${totalScanned} updated=${totalUpdated} skipped=${totalSkipped}`,
  );
  await sql.end();
}

// Run when invoked directly via tsx; skip on import (e.g., tests).
const invokedDirectly = (() => {
  const arg = process.argv[1] ?? "";
  return arg.includes("backfill_papers_size_bytes");
})();
if (invokedDirectly) {
  main().catch((e) => {
    console.error("[backfill] fatal:", e);
    process.exit(1);
  });
}
