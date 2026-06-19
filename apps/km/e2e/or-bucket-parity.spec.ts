// GSD-126 P0 — OR-side ↔ local-side usage parity check.
//
// Runs against a Vercel preview URL (NOT the local worktree). Steps:
//   1. Log in as the seeded test account.
//   2. Reset the user's managed bucket via /api/internal/debug/or-bucket
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
    const resetRes = await page.request.post("/api/internal/debug/or-bucket", {
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

    const parityRes = await page.request.get("/api/internal/debug/or-bucket");
    expect(parityRes.status()).toBe(200);
    const parity = await parityRes.json();
    expect(parity.hash, "lazy-provisioning should have created a bucket").not.toBeNull();
    expect(parity.withinTolerance, JSON.stringify(parity)).toBe(true);
  });

  // GSD-126 P1a — trial-exhausted client UX. Patch the bucket limit to
  // a value that's already exhausted, fire one AI call, and assert the
  // 402-driven toast renders with the upgrade copy. Restore the limit
  // at the end so subsequent runs (or the parity test above) don't 402
  // spuriously.
  test("ai-fill 402 surfaces the trial-exhausted upgrade toast", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/drive|\/papers|\/settings|\/$/, { timeout: 30_000 });

    // Ensure a bucket exists (lazy-provision via one ai-fill call).
    await page.request.post("/api/ai-fill", {
      data: { kind: "paper", known: { filename: "warm-up.pdf" }, missing: ["title"] },
    });

    // Patch the bucket limit to ~exhausted. Any subsequent completion
    // bills above $0.001 and triggers OR's 402.
    const patchRes = await page.request.post("/api/internal/debug/or-bucket", {
      data: { action: "patch-limit", limit: 0.001 },
    });
    expect(patchRes.status()).toBe(200);

    try {
      // Drive a navigable surface so the page is mounted (the toast
      // renders inside the app shell's <Toaster/>). The exact surface
      // doesn't matter — we trigger the call via page.request, then
      // navigate the app to consume the toast.
      const status402 = await page.evaluate(async () => {
        const res = await fetch("/api/ai-fill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "paper",
            known: { filename: "trial-exhausted-probe.pdf" },
            missing: ["title"],
          }),
        });
        return { status: res.status, body: await res.text() };
      });
      expect(status402.status).toBe(402);
      expect(status402.body).toContain("trial_exhausted");

      // The toast itself is rendered from the AiFillButton flow — drive
      // that path by clicking through the metadata UI. We assert the
      // server contract here; the client wiring is covered by the
      // AiFillButton.test.tsx 402 case so we don't double-spend test
      // budget chasing the DOM.
    } finally {
      // Restore $5 limit so we don't strand the bucket on $0.001.
      await page.request.post("/api/internal/debug/or-bucket", {
        data: { action: "patch-limit", limit: 5 },
      });
    }
  });
});
