// GSD-126 P0 — OR-side ↔ local-side usage parity check.
//
// Runs against a Vercel preview URL (NOT the local worktree). Steps:
//   1. Log in as the seeded test account.
//   2. Trigger a small AI call (ai-fill on a simple metadata gap).
//   3. Read the user's user_openrouter_keys.or_key_hash via an internal
//      KM helper (admin route or DB probe — TBD by E2E subagent).
//   4. GET https://openrouter.ai/api/v1/keys/{hash} with the org-level
//      OPENROUTER_PROVISIONING_KEY.
//   5. Sum the local openrouter_usage rows for this user since the row's
//      created_at.
//   6. Assert |OR-side - local-side| <= max($0.001, 5% of OR-side).
//
// Why it's skipped here: the preview env doesn't have
// `OPENROUTER_PROVISIONING_KEY` set yet — the orchestrator will sync
// that in a later round and re-dispatch this subagent to flip the
// skip off. Skipping (rather than failing) keeps CI green.

import { test, expect } from "@playwright/test";

test.describe("OR bucket parity (preview only)", () => {
  test("OR-reported usage matches local openrouter_usage sum within tolerance", async ({ page }) => {
    test.skip(
      true,
      "Preview-only: enable once OPENROUTER_PROVISIONING_KEY is wired into the Vercel env. Owner: orchestrator round R2.",
    );

    // Sketch (to be fleshed out in round R2):
    // const TEST_EMAIL = process.env.E2E_TEST_EMAIL!;
    // const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD!;
    // const OR_PROV_KEY = process.env.OPENROUTER_PROVISIONING_KEY!;
    //
    // await page.goto("/sign-in");
    // await page.getByLabel("Email").fill(TEST_EMAIL);
    // await page.getByLabel("Password").fill(TEST_PASSWORD);
    // await page.getByRole("button", { name: /sign in/i }).click();
    // await page.waitForURL(/\/drive|\/papers|\/settings/);
    //
    // // Trigger an ai-fill call.
    // const res = await page.request.post("/api/ai-fill", {
    //   data: { kind: "paper", known: { filename: "test.pdf" }, missing: ["title"] },
    // });
    // expect(res.status()).toBeLessThan(500);
    //
    // // Fetch the user's bucket hash (debug endpoint TBD).
    // const hashRes = await page.request.get("/api/internal/_debug/or-hash");
    // const { hash } = await hashRes.json();
    //
    // // Wait for OR usage to settle.
    // await page.waitForTimeout(30_000);
    //
    // const orResp = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
    //   headers: { Authorization: `Bearer ${OR_PROV_KEY}` },
    // });
    // const orJson = await orResp.json();
    // const orUsage = orJson.data?.usage ?? orJson.usage ?? 0;
    //
    // const localResp = await page.request.get("/api/internal/_debug/or-local-sum");
    // const { totalUsd: localUsage } = await localResp.json();
    //
    // const diff = Math.abs(orUsage - localUsage);
    // const tolerance = Math.max(0.001, orUsage * 0.05);
    // expect(diff).toBeLessThanOrEqual(tolerance);

    expect(true).toBe(true);
  });
});
