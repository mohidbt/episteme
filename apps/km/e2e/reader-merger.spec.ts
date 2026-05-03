import { test, expect } from "@playwright/test";

// Phase 1.6a inhale-merger gate: structural assertions only.
// Functional smoke (PDF render, highlight create, citation extract) covered by
// the per-feature reader-*.spec.ts files. This spec asserts the URL contract:
// /papers/[id]/read mounts, /r/[id] is gone, /p/[id] iframe view still works.

test.describe("Phase 1.6a inhale merger — structural gate", () => {
  test("/r/[docId] no longer exists", async ({ page }) => {
    const res = await page.goto("/r/non-existent-doc-id", { waitUntil: "load" });
    expect(res?.status()).toBe(404);
  });

  test("/papers/[id]/read mounts <Reader> with data attrs", async ({ page }) => {
    const paperId = process.env.TEST_PAPER_ID;
    test.skip(!paperId, "set TEST_PAPER_ID env var to enable");

    await page.goto(`/papers/${paperId}/read`);
    await expect(page.locator("[data-reader-root]")).toBeVisible();
    await expect(
      page.locator('[data-reader-root][data-reader-mode="full"]'),
    ).toBeVisible();
  });

  test("/p/[paperId] iframe quick-look still works", async ({ page }) => {
    const paperId = process.env.TEST_PAPER_ID;
    test.skip(!paperId, "set TEST_PAPER_ID env var to enable");

    await page.goto(`/p/${paperId}`);
    await expect(page.locator("iframe")).toBeVisible();
  });

  test("/r/[refId] (references namespace) still works", async ({ page }) => {
    const refId = process.env.TEST_REFERENCE_ID;
    test.skip(!refId, "set TEST_REFERENCE_ID env var to enable");

    const res = await page.goto(`/r/${refId}`);
    expect(res?.status()).toBeLessThan(400);
  });
});
