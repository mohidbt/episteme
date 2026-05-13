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

// Schema-qualifier prefix (non-capturing): optional `schema.` or `"schema".`
const QUAL = `(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\\.)?`;
const IDENT = `(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))`;
// Table identifier: optionally schema-qualified, but we only capture the table portion.
const TABLE = `${QUAL}${IDENT}`;

// Clauses that can be matched anywhere in an ALTER TABLE statement (we strip the
// `ALTER TABLE <table>` prefix and scan the remaining clause-list with `g`).
const CLAUSE_PATTERNS: { kind: RiskyDDL["kind"]; re: RegExp }[] = [
  {
    kind: "SET NOT NULL",
    re: new RegExp(`ALTER\\s+COLUMN\\s+${IDENT}\\s+SET\\s+NOT\\s+NULL`, "gi"),
  },
  {
    kind: "ALTER COLUMN TYPE",
    re: new RegExp(
      `ALTER\\s+COLUMN\\s+${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE\\s`,
      "gi",
    ),
  },
  {
    kind: "DROP COLUMN",
    re: new RegExp(`DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, "gi"),
  },
  {
    kind: "ADD COLUMN",
    re: new RegExp(`ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, "gi"),
  },
  {
    kind: "ADD CONSTRAINT",
    re: new RegExp(`ADD\\s+CONSTRAINT\\s+${IDENT}`, "gi"),
  },
];

// Matches the `ALTER TABLE [ONLY] <table>` prefix and captures the table identifier.
const ALTER_TABLE_PREFIX = new RegExp(
  `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${TABLE}`,
  "i",
);

function pickIdent(g1: string | undefined, g2: string | undefined): string {
  return (g1 ?? g2 ?? "").trim();
}

/**
 * Strip SQL line comments (`-- ...`), block comments (`/* ... *\/`), and
 * single-quoted string literals from `sql` while preserving newlines so line
 * numbers remain valid for downstream reporting.
 */
export function stripCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    // line comment
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") {
        i++;
      }
      continue;
    }
    // block comment
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) {
        // keep newlines
        if (sql[i] === "\n") out += "\n";
        i++;
      }
      i += 2; // skip closing */
      continue;
    }
    // single-quoted string literal (handles '' as escaped quote)
    if (c === "'") {
      out += " ";
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        if (sql[i] === "\n") out += "\n";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

type Statement = { text: string; startLine: number };

/**
 * Split a SQL string into statements on `;` boundaries. Comments and string
 * literals must already be stripped (so we don't split inside them). Returns
 * each statement's text plus the 1-based line number of its first non-empty
 * character — used for reporting.
 */
function splitStatements(strippedSql: string): Statement[] {
  const stmts: Statement[] = [];
  const parts = strippedSql.split(";");
  let lineCursor = 1;
  for (const part of parts) {
    const leadingMatch = part.match(/^(\s*)/);
    const leading = leadingMatch ? leadingMatch[1] : "";
    const newlinesBeforeContent = (leading.match(/\n/g) || []).length;
    const startLine = lineCursor + newlinesBeforeContent;
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      stmts.push({ text: part, startLine });
    }
    lineCursor += (part.match(/\n/g) || []).length;
    // account for the `;` itself (no newline contribution)
  }
  return stmts;
}

export function extractRiskyDDL(sql: string): RiskyDDL[] {
  const cleaned = stripCommentsAndStrings(sql);
  const hits: RiskyDDL[] = [];
  for (const stmt of splitStatements(cleaned)) {
    const prefixMatch = stmt.text.match(ALTER_TABLE_PREFIX);
    if (!prefixMatch) continue;
    const table = pickIdent(prefixMatch[1], prefixMatch[2]);
    // Scan the clause-list (everything after the prefix) for risky operations.
    const tail = stmt.text.slice(prefixMatch.index! + prefixMatch[0].length);
    for (const { kind, re } of CLAUSE_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(tail)) !== null) {
        const name = pickIdent(m[1], m[2]);
        const raw = stmt.text.replace(/\s+/g, " ").trim();
        hits.push({ line: stmt.startLine, kind, table, name, raw });
      }
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

async function listChangedMigrationFiles(repoRoot: string): Promise<string[]> {
  const baseRef = (process.env.GITHUB_BASE_REF || "main").trim() || "main";
  const diffRange = `origin/${baseRef}...HEAD`;
  const { stdout } = await execFileP(
    "git",
    [
      "diff",
      diffRange,
      "--name-only",
      "--diff-filter=AM",
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

const SKIP_TOKEN_RE = /predeploy-lint:skip[ \t]+(\S[^\n]*)/;

export function parseSkipReason(prBody: string | undefined): string | null {
  if (typeof prBody !== "string") return null;
  const m = prBody.match(SKIP_TOKEN_RE);
  if (!m) return null;
  const reason = m[1].trim();
  return reason.length > 0 ? reason : null;
}

export function shouldSkipLint(prBody: string | undefined): boolean {
  return parseSkipReason(prBody) !== null;
}

async function main(): Promise<void> {
  const prBody = process.env.PR_BODY;
  const skipReason = parseSkipReason(prBody);
  if (skipReason) {
    console.log(
      `[lint-schema-drift] skip token present in PR body (reason: ${skipReason}); exiting 0`,
    );
    return;
  }
  if (typeof prBody === "string" && prBody.includes("predeploy-lint:skip")) {
    console.warn(
      "[lint-schema-drift] WARNING: predeploy-lint:skip requires a reason — ignoring bare token and proceeding with lint",
    );
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const schemaPath = join(repoRoot, "packages/db/src/schema-drift.ts");
  const schemaSrc = readFileSync(schemaPath, "utf8");

  const changedPaths = await listChangedMigrationFiles(repoRoot);
  if (changedPaths.length === 0) {
    console.log("[lint-schema-drift] no changed migration files in PR diff");
    return;
  }

  const files = changedPaths
    .filter((p) => existsSync(join(repoRoot, p)))
    .map((p) => ({ path: p, sql: readFileSync(join(repoRoot, p), "utf8") }));

  const violations = findViolations(files, schemaSrc);
  if (violations.length === 0) {
    console.log(`[lint-schema-drift] OK (${files.length} changed migration file(s) scanned)`);
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
