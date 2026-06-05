/**
 * Scene: wow_refs_fill
 *
 * Already authed (storageState). Navigates to /references and triggers the
 * batch AI-fill action.
 *
 * Stable hooks:
 *   - data-testid="refs-row-<id>"
 *   - data-testid="ai-fill-batch-button" (preferred)
 *   - data-testid="ai-fill-button"      (per-row fallback)
 */
import type { Page } from "playwright";

export default async function refsFill(page: Page): Promise<void> {
  const baseUrl = process.env.TOUR_RECORD_BASE_URL ?? "https://tryepisteme.com";
  await page.goto(`${baseUrl}/references`, { waitUntil: "domcontentloaded" });

  const batch = page.locator('[data-testid="ai-fill-batch-button"]').first();
  if (await batch.count()) {
    await batch.waitFor({ state: "visible", timeout: 10_000 });
    await batch.click();
    await page.waitForTimeout(18_000);
    await page.waitForTimeout(2_000);
    return;
  }

  // Fallback: open first row and trigger per-row fill.
  const firstRow = page.locator('[data-testid^="refs-row-"]').first();
  await firstRow.waitFor({ state: "visible", timeout: 10_000 });
  await firstRow.locator("a").first().click();
  const single = page.locator('[data-testid="ai-fill-button"]').first();
  await single.waitFor({ state: "visible", timeout: 10_000 });
  await single.click();
  await page.waitForTimeout(18_000);
  await page.waitForTimeout(2_000);
}
