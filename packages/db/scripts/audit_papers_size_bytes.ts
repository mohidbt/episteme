/**
 * Audit: compare `papers.size_bytes` to R2/MinIO HEAD Content-Length.
 *
 * Read-only — never writes. Reports rows where the DB value disagrees with
 * the authoritative object size. Complements `backfill_papers_size_bytes.ts`
 * which only fills rows where `size_bytes = 0`.
 *
 * Usage:
 *   pnpm --filter @episteme/db tsx scripts/audit_papers_size_bytes.ts
 *
 * Env (required):
 *   OWNER_DATABASE_URL or MIGRATE_DATABASE_URL — Postgres DSN with SELECT on `papers`.
 *   S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION — R2/MinIO creds.
 *
 * Behaviour:
 *   - Selects every row with `storage_url IS NOT NULL`. Does NOT skip `size_bytes=0`
 *     — those count as "stale legacy" and surface in the mismatch tally.
 *   - HEADs each key, compares Content-Length to recorded `size_bytes`.
 *   - Tallies: total, match, mismatch, missing-r2 (HEAD 404), error.
 *   - Prints up to 20 mismatch examples (id, recorded, actual, delta).
 *   - Concurrency 5; progress every 100.
 *
 * Exits 0 always — informational only.
 */

export interface AuditRow {
  id: string;
  size_bytes: number;
  storage_url: string;
}

export interface AuditDeps {
  selectRows: () => AsyncIterable<AuditRow[]>;
  head: (key: string) => Promise<{ contentLength: number } | null>;
  concurrency: number;
  progressEvery: number;
}

export interface AuditMismatch {
  id: string;
  recorded: number;
  actual: number;
  delta: number;
}

export interface AuditResult {
  total: number;
  match: number;
  mismatch: number;
  missingR2: number;
  error: number;
  examples: AuditMismatch[];
}

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
  return async <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () =>
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
      queue.push(run);
      next();
    });
}

export async function runAudit(deps: AuditDeps): Promise<AuditResult> {
  const result: AuditResult = {
    total: 0,
    match: 0,
    mismatch: 0,
    missingR2: 0,
    error: 0,
    examples: [],
  };
  const limit = createLimiter(deps.concurrency);

  for await (const batch of deps.selectRows()) {
    await Promise.all(
      batch.map((row) =>
        limit(async () => {
          result.total++;
          try {
            const headResult = await deps.head(row.storage_url);
            if (headResult === null) {
              result.missingR2++;
            } else if (headResult.contentLength === row.size_bytes) {
              result.match++;
            } else {
              result.mismatch++;
              if (result.examples.length < 20) {
                result.examples.push({
                  id: row.id,
                  recorded: row.size_bytes,
                  actual: headResult.contentLength,
                  delta: headResult.contentLength - row.size_bytes,
                });
              }
            }
          } catch (err) {
            result.error++;
            console.warn(
              `[audit] paper=${row.id} key=${row.storage_url} HEAD err: ${
                (err as Error).message ?? err
              }`,
            );
          }
          if (result.total % deps.progressEvery === 0) {
            console.log(
              `[audit] progress: total=${result.total} match=${result.match} mismatch=${result.mismatch} missingR2=${result.missingR2} error=${result.error}`,
            );
          }
        }),
      ),
    );
  }
  return result;
}

async function main() {
  const dsn = process.env.OWNER_DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL;
  if (!dsn) {
    console.error("[audit] OWNER_DATABASE_URL (or MIGRATE_DATABASE_URL) required");
    process.exit(1);
  }
  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (!bucket || !endpoint || !accessKey || !secretKey) {
    console.error(
      "[audit] S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY required",
    );
    process.exit(1);
  }

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

  const BATCH = 50;

  async function* selectRows(): AsyncIterable<AuditRow[]> {
    let lastId: string | null = null;
    while (true) {
      const rows: AuditRow[] = lastId
        ? await sql`
            SELECT id, size_bytes, storage_url FROM papers
            WHERE storage_url IS NOT NULL
              AND id > ${lastId}
            ORDER BY id ASC
            LIMIT ${BATCH}
          `
        : await sql`
            SELECT id, size_bytes, storage_url FROM papers
            WHERE storage_url IS NOT NULL
            ORDER BY id ASC
            LIMIT ${BATCH}
          `;
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      yield rows;
    }
  }

  const result = await runAudit({
    selectRows,
    head: async (key) => {
      try {
        const out = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        const cl = out.ContentLength;
        if (typeof cl !== "number") return null;
        return { contentLength: cl };
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) {
          return null;
        }
        throw err;
      }
    },
    concurrency: 5,
    progressEvery: 100,
  });

  console.log("[audit] DONE");
  console.log(`  total      = ${result.total}`);
  console.log(`  match      = ${result.match}`);
  console.log(`  mismatch   = ${result.mismatch}`);
  console.log(`  missing R2 = ${result.missingR2}`);
  console.log(`  error      = ${result.error}`);
  if (result.examples.length > 0) {
    console.log("[audit] mismatch examples (first 20):");
    for (const ex of result.examples) {
      const sign = ex.delta > 0 ? "+" : "";
      console.log(
        `  paper=${ex.id} recorded=${ex.recorded} actual=${ex.actual} delta=${sign}${ex.delta}`,
      );
    }
  }
  await sql.end();
}

const invokedDirectly = (() => {
  const arg = process.argv[1] ?? "";
  return arg.includes("audit_papers_size_bytes");
})();
if (invokedDirectly) {
  main().catch((e) => {
    console.error("[audit] fatal:", e);
    process.exit(1);
  });
}
