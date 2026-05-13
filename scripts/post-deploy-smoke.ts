/**
 * Post-deploy smoke test for prod.
 *
 * Runs after every push to main once Vercel finishes deploying. Hits a small
 * set of read-only public endpoints and asserts they 200 + contain expected
 * substrings. Exits 1 on any failure so the CI job goes red and an engineer
 * gets paged.
 *
 * Read-only by construction: every probe is GET, no auth headers, body match
 * is substring-only. Bodies are truncated to 200 chars before logging.
 *
 * Run:
 *   pnpm exec tsx scripts/post-deploy-smoke.ts
 *
 * Env:
 *   SMOKE_BASE_URL  base URL to probe (default https://tryepisteme.com)
 */

export type ProbeSpec = {
  path: string;
  expectStatus?: number;
  // Body must contain ALL of these substrings. Prefer structural markers
  // (tag names, attributes, XML shape) over user-visible copy.
  expectBodyContains?: string | string[];
};

export type ProbeResult = {
  path: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  attempts: number;
  error?: string;
};

// Assertions use structural markers (form tags, input types, XML root)
// rather than user-visible copy, so the smoke survives i18n / copy edits.
const PROBES: ProbeSpec[] = [
  {
    path: "/sign-in",
    expectStatus: 200,
    expectBodyContains: ["<form", 'type="email"'],
  },
  {
    path: "/sign-up",
    expectStatus: 200,
    expectBodyContains: ["<form", 'type="email"'],
  },
  { path: "/robots.txt", expectStatus: 200, expectBodyContains: "sitemap" },
  { path: "/sitemap.xml", expectStatus: 200, expectBodyContains: "<urlset" },
];

const DEFAULT_BASE_URL = "https://tryepisteme.com";
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3; // initial + 2 retries
const RETRY_DELAY_MS = 2_000;

function truncate(s: string, n = 200): string {
  return s.length <= n ? s : s.slice(0, n) + "…(truncated)";
}

async function fetchOnce(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "GET", signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

export async function runProbe(
  baseUrl: string,
  probe: ProbeSpec,
  deps: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
  } = {},
): Promise<ProbeResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;

  const url = baseUrl.replace(/\/$/, "") + probe.path;
  const expectStatus = probe.expectStatus ?? 200;

  const start = Date.now();
  let attempts = 0;
  let lastError = "unknown";
  let lastStatus: number | null = null;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const { status, body } = await fetchOnce(url, timeoutMs, fetchImpl);
      lastStatus = status;
      const needles = probe.expectBodyContains === undefined
        ? []
        : Array.isArray(probe.expectBodyContains)
          ? probe.expectBodyContains
          : [probe.expectBodyContains];
      const missing = needles.filter((n) => !body.includes(n));
      if (status !== expectStatus) {
        lastError = `status ${status} != ${expectStatus}; body=${truncate(body)}`;
      } else if (missing.length > 0) {
        lastError = `body missing substring ${JSON.stringify(
          missing.length === 1 ? missing[0] : missing,
        )}; body=${truncate(body)}`;
      } else {
        return {
          path: probe.path,
          ok: true,
          status,
          durationMs: Date.now() - start,
          attempts,
        };
      }
    } catch (e) {
      lastError = `fetch error: ${(e as Error).message}`;
    }
    if (attempts < maxAttempts) await sleep(retryDelayMs);
  }

  return {
    path: probe.path,
    ok: false,
    status: lastStatus,
    durationMs: Date.now() - start,
    attempts,
    error: lastError,
  };
}

export async function runSmoke(
  baseUrl: string,
  probes: ProbeSpec[],
  deps?: Parameters<typeof runProbe>[2],
): Promise<{ allOk: boolean; results: ProbeResult[] }> {
  const results: ProbeResult[] = [];
  for (const p of probes) {
    const r = await runProbe(baseUrl, p, deps);
    results.push(r);
  }
  return { allOk: results.every((r) => r.ok), results };
}

export function formatResult(r: ProbeResult): string {
  const tag = r.ok ? "PASS" : "FAIL";
  const status = r.status ?? "n/a";
  const base = `[${tag}] ${r.path}  status=${status}  attempts=${r.attempts}  ${r.durationMs}ms`;
  return r.ok ? base : `${base}\n        error: ${r.error}`;
}

// Entrypoint guard: only run when invoked as a script, not when imported.
const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return argv1.endsWith("post-deploy-smoke.ts") ||
      argv1.endsWith("post-deploy-smoke.js");
  } catch {
    return false;
  }
})();

if (isMain) {
  const baseUrl = process.env.SMOKE_BASE_URL ?? DEFAULT_BASE_URL;
  console.log(`post-deploy-smoke: base=${baseUrl} probes=${PROBES.length}`);
  runSmoke(baseUrl, PROBES).then(({ allOk, results }) => {
    for (const r of results) console.log(formatResult(r));
    const failed = results.filter((r) => !r.ok).length;
    console.log(
      `post-deploy-smoke: ${allOk ? "OK" : "FAIL"}  ${results.length - failed}/${results.length} passed`,
    );
    process.exit(allOk ? 0 : 1);
  });
}

export { PROBES, DEFAULT_BASE_URL };
