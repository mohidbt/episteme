/**
 * Scene: wow_citations
 *
 * Authed via storageState. On a paper detail page (/p/<id>), clicks the
 * "Find citations" button to trigger live extraction, waits for the
 * citations list to populate, then clicks "Save to library" on the first
 * citation row.
 *
 * Fixture: env TOUR_RECORD_PAPER_URL must be a paper detail URL
 * (e.g. /p/<spontaneous-switching-id>) seeded WITHOUT pre-existing
 * citations — the recording shows the actual extract flow.
 *
 * Stable hooks:
 *   - aria-label="Find citations"               (extraction trigger)
 *   - [data-testid="paper-citations-list"]      (list appears after extract)
 *   - aria-label="Save to library"              (per-row save button)
 */
import type { Page } from "playwright";

export default async function citations(page: Page): Promise<void> {
  const fixture = process.env.TOUR_RECORD_PAPER_URL;
  if (!fixture) {
    throw new Error(
      "TOUR_RECORD_PAPER_URL must be set to a paper detail URL (/p/<id>)",
    );
  }
  await page.goto(fixture, { waitUntil: "domcontentloaded" });

  // Click "Find citations".
  const findBtn = page.locator('[aria-label="Find citations"]').first();
  await findBtn.waitFor({ state: "visible", timeout: 10_000 });
  await findBtn.scrollIntoViewIfNeeded().catch(() => {});
  await findBtn.click();

  // Wait for the citations list to render. Extraction varies (~10-25s).
  const list = page.locator('[data-testid="paper-citations-list"]');
  await list.waitFor({ state: "visible", timeout: 60_000 });
  // Brief settle so the first row's Save button is clickable.
  await page.waitForTimeout(1_500);

  // Click "Save to library" on the first citation.
  const saveBtn = page.locator('[aria-label="Save to library"]').first();
  await saveBtn.waitFor({ state: "visible", timeout: 10_000 });
  await saveBtn.scrollIntoViewIfNeeded().catch(() => {});
  await saveBtn.click();

  // Hold so the toast / state transition is visible in the recording.
  await page.waitForTimeout(3_000);
}
