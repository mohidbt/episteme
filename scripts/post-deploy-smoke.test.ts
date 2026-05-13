/**
 * Tests for post-deploy-smoke probe logic.
 *
 * Run with:
 *   node --test --import tsx scripts/post-deploy-smoke.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runProbe, runSmoke, PROBES } from "./post-deploy-smoke.ts";

function mkFetch(
  handler: (url: string, attempt: number) => Promise<Response> | Response,
) {
  let attempt = 0;
  const fn = (async (input: RequestInfo | URL) => {
    attempt++;
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, attempt);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, getAttempts: () => attempt };
}

const noSleep = async () => {};

test("runProbe: 200 + body match passes on first try", async () => {
  const { fetchImpl, getAttempts } = mkFetch(
    () => new Response("hello world", { status: 200 }),
  );
  const r = await runProbe(
    "https://example.test",
    { path: "/", expectBodyContains: "hello" },
    { fetchImpl, sleep: noSleep },
  );
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.attempts, 1);
  assert.equal(getAttempts(), 1);
});

test("runProbe: 500 fails after retries", async () => {
  const { fetchImpl, getAttempts } = mkFetch(
    () => new Response("server error", { status: 500 }),
  );
  const r = await runProbe(
    "https://example.test",
    { path: "/x" },
    { fetchImpl, sleep: noSleep, maxAttempts: 3 },
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.equal(r.attempts, 3);
  assert.equal(getAttempts(), 3);
  assert.match(r.error ?? "", /status 500 != 200/);
});

test("runProbe: 200 with missing substring fails", async () => {
  const { fetchImpl } = mkFetch(
    () => new Response("nothing here", { status: 200 }),
  );
  const r = await runProbe(
    "https://example.test",
    { path: "/", expectBodyContains: "Sign in" },
    { fetchImpl, sleep: noSleep },
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 200);
  assert.match(r.error ?? "", /missing substring/);
});

test("runProbe: network error retries then fails", async () => {
  const { fetchImpl, getAttempts } = mkFetch(() => {
    throw new Error("ECONNRESET");
  });
  const r = await runProbe(
    "https://example.test",
    { path: "/" },
    { fetchImpl, sleep: noSleep, maxAttempts: 3 },
  );
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.equal(getAttempts(), 3);
  assert.match(r.error ?? "", /fetch error/);
});

test("runProbe: transient failure then success", async () => {
  const { fetchImpl, getAttempts } = mkFetch((_url, attempt) => {
    if (attempt === 1) throw new Error("cold start");
    return new Response("ok body", { status: 200 });
  });
  const r = await runProbe(
    "https://example.test",
    { path: "/", expectBodyContains: "ok" },
    { fetchImpl, sleep: noSleep, maxAttempts: 3 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(getAttempts(), 2);
});

test("runProbe: builds URL by joining base and path (handles trailing slash)", async () => {
  let seen = "";
  const fetchImpl = (async (input: RequestInfo | URL) => {
    seen = typeof input === "string" ? input : input.toString();
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;
  await runProbe(
    "https://example.test/",
    { path: "/sign-in" },
    { fetchImpl, sleep: noSleep },
  );
  assert.equal(seen, "https://example.test/sign-in");
});

test("runSmoke: empty probe list returns allOk=true", async () => {
  const r = await runSmoke("https://example.test", []);
  assert.equal(r.allOk, true);
  assert.deepEqual(r.results, []);
});

test("runProbe: array expectBodyContains requires ALL substrings", async () => {
  const { fetchImpl } = mkFetch(
    () =>
      new Response('<html><form><input type="email" /></form></html>', {
        status: 200,
      }),
  );
  const r = await runProbe(
    "https://example.test",
    { path: "/sign-in", expectBodyContains: ["<form", 'type="email"'] },
    { fetchImpl, sleep: noSleep },
  );
  assert.equal(r.ok, true);
});

test("runProbe: array expectBodyContains fails when any substring missing", async () => {
  const { fetchImpl } = mkFetch(
    () => new Response("<html><form>nope</form></html>", { status: 200 }),
  );
  const r = await runProbe(
    "https://example.test",
    { path: "/sign-in", expectBodyContains: ["<form", 'type="email"'] },
    { fetchImpl, sleep: noSleep },
  );
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /missing substring/);
  assert.match(r.error ?? "", /type=\\"email\\"/);
});

test("PROBES: configured assertions are structural, not copy-based", () => {
  const byPath = Object.fromEntries(PROBES.map((p) => [p.path, p]));
  const signIn = byPath["/sign-in"]!.expectBodyContains;
  assert.ok(Array.isArray(signIn) && signIn.includes("<form"));
  assert.ok(Array.isArray(signIn) && signIn.includes('type="email"'));
  const signUp = byPath["/sign-up"]!.expectBodyContains;
  assert.ok(Array.isArray(signUp) && signUp.includes("<form"));
  assert.ok(Array.isArray(signUp) && signUp.includes('type="email"'));
  assert.equal(byPath["/sitemap.xml"]!.expectBodyContains, "<urlset");
});

test("runSmoke: aggregates pass + fail correctly", async () => {
  const { fetchImpl } = mkFetch((url) => {
    if (url.endsWith("/a")) return new Response("good", { status: 200 });
    return new Response("bad", { status: 500 });
  });
  const r = await runSmoke(
    "https://example.test",
    [
      { path: "/a", expectBodyContains: "good" },
      { path: "/b" },
    ],
    { fetchImpl, sleep: noSleep, maxAttempts: 2 },
  );
  assert.equal(r.allOk, false);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].ok, true);
  assert.equal(r.results[1].ok, false);
});
