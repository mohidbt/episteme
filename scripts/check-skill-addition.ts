#!/usr/bin/env tsx
/**
 * Scalability regression gate — proves PRD §5.4.7:
 *   "adding a 9th agent = one SKILL.md commit, zero core changes."
 *
 * Steps (per Phase 1.3b Task 12):
 *   1. Snapshot `git diff` of services/agents/ excluding services/agents/skills/.
 *   2. Apply a fixture skill at services/agents/skills/<FIXTURE_SKILL_NAME>/SKILL.md.
 *   3. Spawn the FastAPI service (uvicorn) on an ephemeral port — boot smoke:
 *      proves the new SKILL.md doesn't break Python imports.
 *   4. POST /agents/km/config with enabledSkills=[<FIXTURE_SKILL_NAME>] —
 *      proves the in-memory config router accepts the skill name.
 *   5. STRICT LOAD ASSERTION (disk-parse): run a small Python program inside
 *      services/agents/ that imports `_parse_skill_md_text` and asserts the
 *      fixture's SKILL.md parses into a SkillSpec with the expected name.
 *      This mirrors what DriveSkillsLoader._seed_from_disk would copy into
 *      drive notes on first use, without requiring KM to be running.
 *      Live drive-side parse is covered by tests/test_drive_skills_loader.py.
 *   6. Always delete the fixture (finally).
 *   7. Re-snapshot diff outside skills/ and assert it didn't expand.
 *
 * Notes:
 *   - The spec illustrated the fixture name as "__fixture-skill__", but the
 *     skill loader (services/agents/skills/__init__.py) skips directories
 *     starting with "_" or ".". Changing the loader to allow underscored
 *     names would itself be a "core change" — the exact thing this gate
 *     forbids. So we use a non-underscored name for the fixture.
 *   - We previously hit /agents/km/debug/loaded_skills + /agents/km/invoke
 *     here, but both paths require KM at :3001 (DriveSkillsLoader bootstraps
 *     via NotesBackend → /api/folders). CI has no KM, so those steps were
 *     unreachable behind a uvicorn entrypoint bug; once that bug was fixed
 *     they reliably 500'd. The disk-parse assertion is the deterministic
 *     equivalent for the gate's purpose (PRD §5.4.7 loadable invariant).
 *   - Requires INHALE_INTERNAL_SECRET env var (HMAC) for the /config call.
 */
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readdirSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const AGENTS_DIR = join(REPO_ROOT, "services", "agents");
const SKILLS_DIR = join(AGENTS_DIR, "skills");
const FIXTURE_SKILL_NAME = "fixture-skill-scalability-gate";
const FIXTURE_DIR = join(SKILLS_DIR, FIXTURE_SKILL_NAME);
const FIXTURE_SKILL_PATH = join(FIXTURE_DIR, "SKILL.md");

const SECRET = process.env.INHALE_INTERNAL_SECRET || "test-secret-scalability";
const TEST_USER_ID = `gate-user-${randomUUID()}`;

// Module-scope handle so the SIGINT/SIGTERM handlers below can kill the
// spawned uvicorn child. Without this, signal-driven exit orphans the port —
// caller's next gate run would race a still-listening uvicorn (fix #7).
let activeUvicornProc: ChildProcessWithoutNullStreams | null = null;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested by check-skill-addition.test.ts)
// ---------------------------------------------------------------------------

/**
 * Compares two `git diff` outputs for byte-equivalence after right-trimming
 * trailing whitespace. Used to assert the gate's diff invariant.
 */
export function diffsEqual(a: string, b: string): boolean {
  return a.replace(/\s+$/g, "") === b.replace(/\s+$/g, "");
}

/**
 * Returns the SKILL.md frontmatter+body string we write into the fixture dir.
 * Mirrors the contract of services/agents/skills/__init__.py: every required
 * frontmatter field is present and the body is non-empty.
 */
export function fixtureSkillContent(): string {
  return [
    "---",
    `name: ${FIXTURE_SKILL_NAME}`,
    "description: Fixture skill used by check-skill-addition.ts to verify scalability gate.",
    "tools: [search_notes]",
    "subagents: []",
    "require_approval: []",
    "---",
    "",
    "# Fixture skill body — invoked by scripts/check-skill-addition.ts.",
    "Reply with the literal string: __fixture_invoked__.",
    "",
  ].join("\n");
}

/**
 * Asserts a candidate fixture path is within services/agents/skills/ and
 * does not escape via `..`. Defensive — we never want the cleanup step to
 * delete anything outside the skills/ tree.
 */
export function isFixturePathInsideSkillsDir(relPath: string): boolean {
  const norm = normalize(relPath);
  if (norm.includes("..")) return false;
  return norm.startsWith("services/agents/skills/");
}

/**
 * Returns true if `<skillsDir>/<name>` already contains a SKILL.md — caller
 * should refuse to clobber an existing skill.
 */
export function fixtureCollidesWithExistingSkill(
  skillsDir: string,
  name: string,
): boolean {
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === name) {
        return existsSync(join(skillsDir, name, "SKILL.md"));
      }
    }
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitDiffOutsideSkills(): string {
  const result = spawnSync(
    "git",
    [
      "-C",
      REPO_ROOT,
      "diff",
      "--",
      "services/agents/",
      ":(exclude)services/agents/skills/",
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`git diff failed: ${result.stderr}`);
  }
  return result.stdout;
}

function gitUntrackedOutsideSkills(): string {
  const result = spawnSync(
    "git",
    [
      "-C",
      REPO_ROOT,
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "services/agents/",
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .filter((p) => p && !p.startsWith("services/agents/skills/"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// HMAC signer (mirrors services/agents/lib/km_http.py)
// ---------------------------------------------------------------------------

function signRequest(
  method: string,
  path: string,
  body: Buffer | string,
): { ts: string; sig: string } {
  const ts = String(Math.floor(Date.now() / 1000));
  const bodyBuf = typeof body === "string" ? Buffer.from(body) : body;
  const msg = Buffer.concat([
    Buffer.from(ts),
    Buffer.from(method),
    Buffer.from(path),
    bodyBuf,
  ]);
  const sig = createHmac("sha256", SECRET).update(msg).digest("hex");
  return { ts, sig };
}

function authHeaders(
  method: string,
  path: string,
  body: Buffer | string,
): Record<string, string> {
  const { ts, sig } = signRequest(method, path, body);
  return {
    "X-Inhale-User-Id": TEST_USER_ID,
    "X-Inhale-LLM-Key": process.env.INHALE_LLM_KEY || "sk-fake-for-build-only",
    "X-Inhale-Ts": ts,
    "X-Inhale-Sig": sig,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// FastAPI process management
// ---------------------------------------------------------------------------

async function pickEphemeralPort(): Promise<number> {
  // Bind a transient socket to port 0 to discover a free port, then close.
  const net = await import("node:net");
  return await new Promise<number>((resolveFn, rejectFn) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", rejectFn);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolveFn(port));
      } else {
        rejectFn(new Error("could not get ephemeral port"));
      }
    });
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  // /agents/health requires HMAC; /openapi.json is FastAPI's default unauth
  // endpoint and only responds 200 after the app has fully booted.
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/openapi.json`);
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await delay(250);
  }
  throw new Error(
    `FastAPI did not become healthy on port ${port} within ${timeoutMs}ms (last err: ${lastErr})`,
  );
}

async function spawnFastapi(port: number): Promise<ChildProcessWithoutNullStreams> {
  const env = {
    ...process.env,
    INHALE_INTERNAL_SECRET: SECRET,
    PYTHONUNBUFFERED: "1",
  };
  const proc = spawn(
    "uv",
    [
      "run",
      "uvicorn",
      "app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-level",
      "warning",
    ],
    {
      cwd: AGENTS_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  proc.stdout.on("data", (b: Buffer) => {
    process.stderr.write(`[uvicorn] ${b.toString()}`);
  });
  proc.stderr.on("data", (b: Buffer) => {
    process.stderr.write(`[uvicorn] ${b.toString()}`);
  });
  proc.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(
        `[uvicorn] exited unexpectedly: code=${code} signal=${signal}\n`,
      );
    }
  });

  await waitForHealth(port, 30_000);
  return proc;
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

function applyFixture(): void {
  if (!isFixturePathInsideSkillsDir(`services/agents/skills/${FIXTURE_SKILL_NAME}`)) {
    throw new Error("refusing to write fixture outside services/agents/skills/");
  }
  if (fixtureCollidesWithExistingSkill(SKILLS_DIR, FIXTURE_SKILL_NAME)) {
    throw new Error(
      `fixture name "${FIXTURE_SKILL_NAME}" collides with an existing skill`,
    );
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(FIXTURE_SKILL_PATH, fixtureSkillContent(), "utf-8");
}

function revertFixture(): void {
  if (!existsSync(FIXTURE_DIR)) return;
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Step 0: refuse to run on a dirty tree (prevents false positives).
  const baselineDiff = gitDiffOutsideSkills();
  const baselineUntracked = gitUntrackedOutsideSkills();
  if (baselineDiff.trim() !== "" || baselineUntracked.trim() !== "") {
    process.stderr.write(
      "ERROR: working tree dirty outside services/agents/skills/. Commit or stash first.\n",
    );
    process.stderr.write(`diff:\n${baselineDiff}\nuntracked:\n${baselineUntracked}\n`);
    process.exit(1);
  }

  let proc: ChildProcessWithoutNullStreams | null = null;
  let exitCode = 0;
  try {
    // Step 1+2: snapshot baseline already taken; apply fixture.
    applyFixture();

    // Step 3: spawn FastAPI on an ephemeral port.
    const port = await pickEphemeralPort();
    proc = await spawnFastapi(port);
    activeUvicornProc = proc;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Step 4: POST /agents/km/config — enable the fixture skill.
    {
      // save_user_config replaces the whole record — we must supply every
      // field the /invoke handler dereferences (esp. modelPreference).
      const body = JSON.stringify({
        enabledSkills: [FIXTURE_SKILL_NAME],
        attachedMcps: [],
        modelPreference: "google/gemma-4-26b-a4b-it",
        approvalRules: { publish: "require", external_send: "require", write_note: "auto" },
      });
      const path = "/agents/km/config";
      const res = await fetch(baseUrl + path, {
        method: "POST",
        headers: authHeaders("POST", path, body),
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`/config returned ${res.status}: ${text}`);
      }
    }

    // Step 5: strict load assertion via disk-parse. We invoke the same
    // _parse_skill_md_text() function that DriveSkillsLoader uses against
    // the fixture's on-disk SKILL.md. If the parse returns None (missing
    // frontmatter, bad shape) the gate fails — which is the regression we
    // care about for PRD §5.4.7 ("adding a SKILL.md is sufficient").
    // Live drive bootstrap+parse is covered by the agents pytest suite
    // (tests/test_drive_skills_loader.py) where NotesBackend is mocked.
    {
      const py = [
        "import sys",
        "from pathlib import Path",
        "from skills import SKILLS_ROOT, _parse_skill_md_text",
        `name = ${JSON.stringify(FIXTURE_SKILL_NAME)}`,
        "skill_md = SKILLS_ROOT / name / 'SKILL.md'",
        "spec = _parse_skill_md_text(skill_md.read_text(encoding='utf-8'), skill_md)",
        "if spec is None:",
        "    sys.exit(f'parse returned None for {skill_md}')",
        "if spec.name != name:",
        "    sys.exit(f'parsed name {spec.name!r} != fixture {name!r}')",
        "print(spec.name)",
      ].join("\n");
      const result = spawnSync("uv", ["run", "python", "-c", py], {
        cwd: AGENTS_DIR,
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        throw new Error(
          `disk-parse assertion failed (exit ${result.status}): ${result.stderr || result.stdout}`,
        );
      }
      if (!result.stdout.includes(FIXTURE_SKILL_NAME)) {
        throw new Error(
          `disk-parse stdout missing fixture name; got ${JSON.stringify(result.stdout)}`,
        );
      }
    }

    // Step 7: re-snapshot. Diff invariant must hold.
    const finalDiff = gitDiffOutsideSkills();
    const finalUntracked = gitUntrackedOutsideSkills();
    if (!diffsEqual(baselineDiff, finalDiff)) {
      process.stderr.write("FAIL: services/agents/ diff outside skills/ expanded.\n");
      process.stderr.write(`---baseline---\n${baselineDiff}\n---after---\n${finalDiff}\n`);
      exitCode = 1;
    }
    if (!diffsEqual(baselineUntracked, finalUntracked)) {
      process.stderr.write(
        "FAIL: untracked files appeared in services/agents/ outside skills/.\n",
      );
      process.stderr.write(
        `---baseline---\n${baselineUntracked}\n---after---\n${finalUntracked}\n`,
      );
      exitCode = 1;
    }

    if (exitCode === 0) {
      process.stdout.write(
        `OK: PRD §5.4.7 scalability gate held — fixture skill loaded with zero core changes.\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`);
    if ((err as Error).stack) process.stderr.write(`${(err as Error).stack}\n`);
    exitCode = 1;
  } finally {
    // Step 6 (finally): revert fixture unconditionally.
    revertFixture();
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
      // Give it a moment to flush, then SIGKILL if still alive.
      await delay(500);
      if (!proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already dead
        }
      }
    }
    activeUvicornProc = null;
  }

  process.exit(exitCode);
}

// Run main only when executed as a CLI (not when imported by the test file).
const invokedAsCli = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (invokedAsCli) {
  // Best-effort cleanup if the user ^C's mid-run. Must kill the spawned
  // uvicorn child before exiting — otherwise the port stays bound and a
  // re-run would either pick a different port (good) but leave the orphan
  // running (bad). Fix #7.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      revertFixture();
      if (activeUvicornProc && !activeUvicornProc.killed) {
        try {
          activeUvicornProc.kill("SIGTERM");
        } catch {
          // already dead — proceed to exit
        }
      }
      process.exit(130);
    });
  }
  main().catch((err) => {
    process.stderr.write(`unhandled: ${err}\n`);
    revertFixture();
    if (activeUvicornProc && !activeUvicornProc.killed) {
      try {
        activeUvicornProc.kill("SIGTERM");
      } catch {
        // already dead
      }
    }
    process.exit(1);
  });
}
