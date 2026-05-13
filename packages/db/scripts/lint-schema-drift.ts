import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// execFile (not exec) — args passed as array, no shell interpolation of any PR-derived value.
const execFileP = promisify(execFile);

export type RiskyDDL = {
  line: number;
  kind:
    | "ADD COLUMN"
    | "SET NOT NULL"
    | "DROP COLUMN"
    | "ADD CONSTRAINT"
    | "ALTER COLUMN TYPE";
  table: string;
  name: string;
  raw: string;
};

export type Violation = RiskyDDL & { file: string };

const IDENT = `(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))`;

const PATTERNS: { kind: RiskyDDL["kind"]; re: RegExp }[] = [
  {
    kind: "SET NOT NULL",
    re: new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ALTER\\s+COLUMN\\s+${IDENT}\\s+SET\\s+NOT\\s+NULL`,
      "i",
    ),
  },
  {
    kind: "ALTER COLUMN TYPE",
    re: new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ALTER\\s+COLUMN\\s+${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE\\s`,
      "i",
    ),
  },
  {
    kind: "DROP COLUMN",
    re: new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`,
      "i",
    ),
  },
  {
    kind: "ADD COLUMN",
    re: new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`,
      "i",
    ),
  },
  {
    kind: "ADD CONSTRAINT",
    re: new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ADD\\s+CONSTRAINT\\s+${IDENT}`,
      "i",
    ),
  },
];

function pickIdent(g1: string | undefined, g2: string | undefined): string {
  return (g1 ?? g2 ?? "").trim();
}

export function extractRiskyDDL(sql: string): RiskyDDL[] {
  const lines = sql.split(/\r?\n/);
  const hits: RiskyDDL[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, re } of PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      const table = pickIdent(m[1], m[2]);
      const name = pickIdent(m[3], m[4]);
      hits.push({ line: i + 1, kind, table, name, raw: line.trim() });
      break;
    }
  }
  return hits;
}

const CHECK_NAME_RE = /'([^']+)'::text\s+as\s+check_name/gi;

export function hasMatchingCheck(
  schemaSrc: string,
  table: string,
  name: string,
): boolean {
  const names: string[] = [];
  let m: RegExpExecArray | null;
  CHECK_NAME_RE.lastIndex = 0;
  while ((m = CHECK_NAME_RE.exec(schemaSrc)) !== null) {
    names.push(m[1]);
  }
  return names.some((n) => n.includes(table) && n.includes(name));
}

export function findViolations(
  files: { path: string; sql: string }[],
  schemaSrc: string,
): Violation[] {
  const violations: Violation[] = [];
  for (const f of files) {
    for (const hit of extractRiskyDDL(f.sql)) {
      if (!hasMatchingCheck(schemaSrc, hit.table, hit.name)) {
        violations.push({ ...hit, file: f.path });
      }
    }
  }
  return violations;
}

async function listNewMigrationFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileP(
    "git",
    [
      "diff",
      "origin/main...HEAD",
      "--name-only",
      "--diff-filter=A",
      "--",
      "packages/db/drizzle/*.sql",
    ],
    { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function shouldSkipLint(prBody: string | undefined): boolean {
  return typeof prBody === "string" && prBody.includes("predeploy-lint:skip");
}

async function main(): Promise<void> {
  if (shouldSkipLint(process.env.PR_BODY)) {
    console.log("[lint-schema-drift] skip token present in PR body; exiting 0");
    return;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const schemaPath = join(repoRoot, "packages/db/src/schema-drift.ts");
  const schemaSrc = readFileSync(schemaPath, "utf8");

  const newPaths = await listNewMigrationFiles(repoRoot);
  if (newPaths.length === 0) {
    console.log("[lint-schema-drift] no new migration files in PR diff");
    return;
  }

  const files = newPaths
    .filter((p) => existsSync(join(repoRoot, p)))
    .map((p) => ({ path: p, sql: readFileSync(join(repoRoot, p), "utf8") }));

  const violations = findViolations(files, schemaSrc);
  if (violations.length === 0) {
    console.log(`[lint-schema-drift] OK (${files.length} new migration file(s) scanned)`);
    return;
  }

  console.error("[lint-schema-drift] FAIL: missing predeploy assertions");
  for (const v of violations) {
    console.error(
      `  ${v.file}:${v.line} ${v.kind} on ${v.table}.${v.name} -> add a check_name in packages/db/src/schema-drift.ts containing both "${v.table}" and "${v.name}"`,
    );
  }
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
