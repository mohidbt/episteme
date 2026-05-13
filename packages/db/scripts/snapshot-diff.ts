import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDump } from "../src/snapshot-normalize.js";

const execFileP = promisify(execFile);

const PG_DUMP_ARGS = [
  "--schema-only",
  "--no-owner",
  "--no-privileges",
  "--no-comments",
];

async function dump(databaseUrl: string): Promise<string> {
  const pgDump = process.env.PG_DUMP_BIN ?? "pg_dump";
  try {
    const { stdout } = await execFileP(pgDump, [...PG_DUMP_ARGS, databaseUrl], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(redactUrl(msg, databaseUrl));
  }
}

function redactUrl(message: string, url: string): string {
  return message.split(url).join("[REDACTED_DATABASE_URL]");
}

/** Minimal unified-style line diff. No external deps. */
function unifiedDiff(
  baseline: string[],
  current: string[],
  baselineLabel: string,
  currentLabel: string,
): string {
  // LCS-based diff would be ideal but overkill; emit each line marker pass.
  // We use a simple Hunt–McIlroy via dynamic programming for small-ish files.
  const m = baseline.length;
  const n = current.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (baseline[i] === current[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const lines: string[] = [`--- ${baselineLabel}`, `+++ ${currentLabel}`];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (baseline[i] === current[j]) {
      lines.push(` ${baseline[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`-${baseline[i]}`);
      i++;
    } else {
      lines.push(`+${current[j]}`);
      j++;
    }
  }
  while (i < m) lines.push(`-${baseline[i++]}`);
  while (j < n) lines.push(`+${current[j++]}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const baselinePath = resolve(repoRoot, "packages/db/schema-snapshot.sql");
  if (!existsSync(baselinePath)) {
    console.error(
      `Baseline not found at ${baselinePath}. Run packages/db/scripts/init-snapshot.sh once to seed.`,
    );
    process.exit(1);
  }
  const baseline = normalizeDump(readFileSync(baselinePath, "utf8"));
  const current = normalizeDump(await dump(databaseUrl));

  if (baseline === current) {
    console.log("[snapshot-diff] OK — schema matches packages/db/schema-snapshot.sql");
    return;
  }

  const diff = unifiedDiff(
    baseline.split("\n"),
    current.split("\n"),
    "packages/db/schema-snapshot.sql",
    "pg_dump $DATABASE_URL",
  );
  console.error(diff);
  console.error("");
  console.error(
    "[snapshot-diff] Schema drift detected vs packages/db/schema-snapshot.sql. " +
      "If intentional (new migration), run `pnpm db:snapshot-update` after deploying.",
  );
  process.exit(1);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
