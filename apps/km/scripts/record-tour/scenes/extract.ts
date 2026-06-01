/**
 * Scene: wow_extract
 *
 * Opens a paperset and triggers "Enrich all missing cells". Captures the
 * first few cells filling, then holds.
 *
 * NOTE: Paperset table currently has no data-testid hooks on the enrich
 * action (only CellGroundingChip is tagged). This scene relies on visible
 * text match for the enrich button. Flagged as Round 2 follow-up: add
 *   - data-testid="paperset-enrich-all"
 * to the paperset toolbar before R3 records this scene.
 *
 * Fixture: env TOUR_RECORD_PAPERSET_URL must be a /papersets/<uuid> the
 * test account can read, ideally psm-survey or another CSV with empty
 * cells.
 */
import type { Page } from "playwright";

export default async function extract(page: Page): Promise<void> {
  const fixture = process.env.TOUR_RECORD_PAPERSET_URL;
  if (!fixture) {
    throw new Error(
      "TOUR_RECORD_PAPERSET_URL must be set to a /papersets/<uuid> URL",
    );
  }
  await page.goto(fixture, { waitUntil: "domcontentloaded" });

  // Best-available selector; replace with data-testid="paperset-enrich-all"
  // once added to PapersetTable.
  const enrich = page
    .getByRole("button", { name: /enrich (all )?missing( cells)?/i })
    .first();
  await enrich.waitFor({ state: "visible", timeout: 10_000 });
  await enrich.click();

  // Watch first 2-3 cells fill (full enrich can take minutes; cap at ~9s).
  await page.waitForTimeout(9_000);
  await page.waitForTimeout(1_000); // hold
}
