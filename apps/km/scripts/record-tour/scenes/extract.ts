/**
 * Scene: wow_extract
 *
 * Authed via storageState. On a paperset detail page (/d/<id> or
 * /papersets/<id>), scrolls to the bottom row, then clicks "Run enrichment"
 * to fill missing cells.
 *
 * Probe findings (2026-05-31):
 *   - [data-testid="paperset-enrich-all"] exists (button label
 *     "Run enrichment").
 *   - Cells use [data-testid="cell-<rowIndex>-<columnName>"]. Em-dash "—"
 *     marks an empty cell.
 *   - Bottom row is row-2 on the seeded paperset fixture.
 *
 * Fixture: env TOUR_RECORD_PAPERSET_URL must be a paperset detail URL.
 */
import type { Page } from "playwright";

export default async function extract(page: Page): Promise<void> {
  const fixture = process.env.TOUR_RECORD_PAPERSET_URL;
  if (!fixture) {
    throw new Error(
      "TOUR_RECORD_PAPERSET_URL must be set to a paperset detail URL",
    );
  }
  await page.goto(fixture, { waitUntil: "domcontentloaded" });

  // Bring the bottom row into view so the recording shows it filling.
  const bottomRow = page.locator('[data-testid="row-header-2"]').first();
  if (await bottomRow.count()) {
    await bottomRow.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1_500);
  }

  const enrich = page.locator('[data-testid="paperset-enrich-all"]').first();
  await enrich.waitFor({ state: "visible", timeout: 10_000 });
  await enrich.click();

  // Watch cells fill (full enrich varies; cap at ~18s).
  await page.waitForTimeout(18_000);
  await page.waitForTimeout(2_000); // hold
}
