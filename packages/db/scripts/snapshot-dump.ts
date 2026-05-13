import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
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

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const defaultPath = resolve(repoRoot, "packages/db/schema-snapshot.sql");
  const outPath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : defaultPath;

  const raw = await dump(databaseUrl);
  const normalized = normalizeDump(raw);
  writeFileSync(outPath, normalized, "utf8");
  console.log(`[snapshot-dump] wrote ${outPath} (${normalized.length} bytes)`);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
