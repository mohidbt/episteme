/**
 * Scene: wow_refs_fill
 *
 * Navigates to /references, finds the first reference row, opens its
 * detail page, and triggers the "Fill missing fields with AI" action.
 *
 * Stable hooks:
 *   - data-testid="refs-view-list" / "refs-view-grid"
 *   - data-testid="refs-row-<id>"     (per row, on /references)
 *   - data-testid="ai-fill-button"    (on /r/<id>, single-field fill)
 *   - data-testid="ai-fill-batch-button" (on /references, batch fill — preferred)
 */
import type { Page } from "playwright";

export default async function refsFill(page: Page): Promise<void> {
  await page.goto(new URL("/references", page.url()).toString(), {
    waitUntil: "domcontentloaded",
  });

  // Prefer batch fill on the references index (one click; no row probe needed).
  const batch = page.locator('[data-testid="ai-fill-batch-button"]').first();
  if (await batch.count()) {
    await batch.waitFor({ state: "visible", timeout: 10_000 });
    await batch.click();
    // Let a few rows visibly resolve.
    await page.waitForTimeout(6_000);
    await page.waitForTimeout(1_500); // hold at end-state
    return;
  }

  // Fallback: open first row and trigger per-row fill.
  const firstRow = page.locator('[data-testid^="refs-row-"]').first();
  await firstRow.waitFor({ state: "visible", timeout: 10_000 });
  await firstRow.locator("a").first().click();
  const single = page.locator('[data-testid="ai-fill-button"]').first();
  await single.waitFor({ state: "visible", timeout: 10_000 });
  await single.click();
  await page.waitForTimeout(6_000);
  await page.waitForTimeout(1_500);
}
