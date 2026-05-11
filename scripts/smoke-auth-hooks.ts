#!/usr/bin/env tsx
/**
 * Smoke: prove better-auth fires our hooks end-to-end.
 *
 * The vitest integration suite under apps/km exercises seedRealUser /
 * cleanupAnonymousR2 by calling them directly — that would still pass
 * even if better-auth STOPPED firing user.create.after / onLinkAccount
 * (silent prod break). This script wires real `createAuth({...})` with
 * spy hooks and exercises `auth.api.signUpEmail` + `signInAnonymous`
 * against the real Postgres adapter to verify the wiring is live.
 *
 * Run: pnpm tsx scripts/smoke-auth-hooks.ts
 * Required env: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL
 * (defaults match the local dev stack).
 *
 * Preflight: if you see `Cannot find module 'better-auth'`, run
 * `pnpm install` from the workspace root — the monorepo's pnpm symlinks
 * can drift after a partial install and need to be re-linked.
 */
import { eq, inArray } from "drizzle-orm";

process.env.DATABASE_URL ??=
  "postgresql://episteme:episteme@localhost:5433/episteme";
process.env.BETTER_AUTH_SECRET ??=
  "test-secret-for-integration-tests-only-not-for-prod";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

import { createAuth } from "../packages/auth/src/server.ts";
import { db } from "../packages/db/src/client.ts";
import { user as userTable } from "../packages/db/src/schema/index.ts";

const createdIds: string[] = [];
const fails: string[] = [];

function uniq(): string {
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    fails.push(label);
  }
}

async function caseDirectSignup() {
  console.log("\n[CASE] direct signUpEmail → onRealUserCreate fires");
  let realCalls = 0;
  let realArg: string | null = null;
  let anonCalls = 0;
  let linkCalls = 0;

  const auth = createAuth({
    onAnonymousUserCreate: async () => {
      anonCalls++;
    },
    onRealUserCreate: async (uid: string) => {
      realCalls++;
      realArg = uid;
      createdIds.push(uid);
    },
    onAnonymousLink: async () => {
      linkCalls++;
    },
  });

  const email = `smoke_direct_${uniq()}@test.local`;
  const result = (await auth.api.signUpEmail({
    body: { email, password: "test-password-1234", name: "Smoke Direct" },
  })) as { user: { id: string } };
  const newId = result.user.id;

  assert(realCalls === 1, "onRealUserCreate fired exactly once");
  assert(realArg === newId, `onRealUserCreate received newUserId (got ${realArg})`);
  assert(anonCalls === 0, "onAnonymousUserCreate did NOT fire");
  assert(linkCalls === 0, "onAnonymousLink did NOT fire");
}

async function caseAnonThenSignup() {
  console.log(
    "\n[CASE] signInAnonymous → onAnonymousUserCreate; then signUpEmail w/ cookie → onRealUserCreate + onAnonymousLink",
  );
  const order: string[] = [];
  let anonId: string | null = null;
  let realId: string | null = null;
  let linkAnonArg: string | null = null;
  let linkNewArg: string | null = null;

  const auth = createAuth({
    onAnonymousUserCreate: async (uid: string) => {
      order.push(`anon:${uid}`);
      createdIds.push(uid);
    },
    onRealUserCreate: async (uid: string) => {
      order.push(`real:${uid}`);
      createdIds.push(uid);
    },
    onAnonymousLink: async (aId: string, nId: string) => {
      order.push(`link:${aId}->${nId}`);
      linkAnonArg = aId;
      linkNewArg = nId;
    },
  });

  // 1) anonymous sign-in
  const { headers, response } = await auth.api.signInAnonymous({
    returnHeaders: true,
  });
  anonId = (response as { user: { id: string } }).user.id;
  const setCookie = headers.get("set-cookie");
  if (!setCookie) throw new Error("signInAnonymous returned no set-cookie");
  const cookie = setCookie.split(";")[0];

  assert(order[0] === `anon:${anonId}`, "anonymous hook fires first w/ anonId");

  // 2) sign-up while anon cookie attached
  const reqHeaders = new Headers({ cookie });
  const email = `smoke_link_${uniq()}@test.local`;
  const result = (await auth.api.signUpEmail({
    body: { email, password: "test-password-1234", name: "Smoke Linked" },
    headers: reqHeaders,
  })) as { user: { id: string } };
  realId = result.user.id;

  const realIdx = order.findIndex((s) => s === `real:${realId}`);
  const linkIdx = order.findIndex((s) => s === `link:${anonId}->${realId}`);

  assert(realIdx >= 0, "onRealUserCreate fired w/ newUserId");
  assert(linkIdx >= 0, "onAnonymousLink fired w/ (anonId, newUserId)");
  assert(linkAnonArg === anonId, "link arg #1 is anonId");
  assert(linkNewArg === realId, "link arg #2 is newUserId");
  assert(
    realIdx < linkIdx,
    "ordering invariant: real-create BEFORE link (so R2 cleanup sees rows)",
  );
}

async function main() {
  try {
    await caseDirectSignup();
    await caseAnonThenSignup();
  } finally {
    if (createdIds.length > 0) {
      await db.delete(userTable).where(inArray(userTable.id, createdIds));
      console.log(`\n[cleanup] deleted ${createdIds.length} test users`);
    }
  }

  console.log("\n=== SUMMARY ===");
  if (fails.length === 0) {
    console.log("ALL HOOKS FIRE CORRECTLY ✓");
    process.exit(0);
  } else {
    console.log(`${fails.length} assertion(s) failed:`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
