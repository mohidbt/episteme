// GSD-126 P0 — OR-side ↔ local-side usage parity check.
//
// Runs against a Vercel preview URL (NOT the local worktree). Steps:
//   1. Log in as the seeded test account.
//   2. Reset the user's managed bucket via /api/internal/_debug/or-bucket
//      so the next AI call lazy-provisions a fresh one.
//   3. Trigger 3 small AI calls (ai-fill on a metadata gap).
//   4. Wait for OR to settle.
//   5. GET the debug endpoint and assert OR-reported usage matches local
//      `openrouter_usage` sum within tolerance ($0.001 OR 5%).
//   6. Sanity-check that the debug endpoint reports a non-null hash (i.e.
//      lazy provisioning succeeded).
//
// Gated on `OPENROUTER_PROVISIONING_KEY` so it stays a no-op in branches
// where the preview env hasn't been wired up yet.

import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "test@mohid.de";
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Testest2026";

test.describe("OR bucket parity (preview only)", () => {
  test.skip(
    !process.env.OPENROUTER_PROVISIONING_KEY,
    "OPENROUTER_PROVISIONING_KEY not set — preview env not wired",
  );

  test("OR-reported usage matches local openrouter_usage sum within tolerance", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/drive|\/papers|\/settings|\/$/, { timeout: 30_000 });

    // Reset: nuke any pre-existing managed bucket row + the OR-side key so
    // the next ai-fill call lazy-provisions a fresh one.
    const resetRes = await page.request.post("/api/internal/_debug/or-bucket", {
      data: { action: "reset" },
    });
    expect(resetRes.status()).toBe(200);

    // Trigger 3 small ai-fill calls. The first one lazy-provisions the bucket.
    for (let i = 0; i < 3; i++) {
      const res = await page.request.post("/api/ai-fill", {
        data: {
          kind: "paper",
          known: { filename: `parity-test-${i}.pdf` },
          missing: ["title"],
        },
      });
      expect(res.status(), `ai-fill call ${i} unexpected status`).toBeLessThan(500);
    }

    // Let OR's accounting settle (it lags ~10-30s behind completions).
    await page.waitForTimeout(30_000);

    const parityRes = await page.request.get("/api/internal/_debug/or-bucket");
    expect(parityRes.status()).toBe(200);
    const parity = await parityRes.json();
    expect(parity.hash, "lazy-provisioning should have created a bucket").not.toBeNull();
    expect(parity.withinTolerance, JSON.stringify(parity)).toBe(true);
  });
});
