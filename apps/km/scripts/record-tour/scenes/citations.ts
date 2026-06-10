/**
 * Scene: wow_citations
 *
 * Already authed (storageState). Navigates to /p/<paperId>, clicks the
 * "Find citations" action, then waits for the live citation list to populate
 * + enrichment to land. The button is disabled if citations already exist —
 * caller must clear `document_references` for this paper before recording.
 *
 * Stable hooks:
 *   - aria-label="Find citations"      (extract trigger)
 *   - data-testid="paper-citations-list" (rendered list)
 *   - data-testid="citations-enriching"  (loader badge while polling)
 *
 * Env:
 *   TOUR_RECORD_CITATIONS_PAPER_ID  required — paper UUID with chandra=done
 */
import type { Page } from "playwright";

export default async function citations(page: Page): Promise<void> {
  const baseUrl = process.env.TOUR_RECORD_BASE_URL ?? "https://tryepisteme.com";
  const paperId = process.env.TOUR_RECORD_CITATIONS_PAPER_ID;
  if (!paperId) {
    throw new Error("TOUR_RECORD_CITATIONS_PAPER_ID required for citations scene");
  }

  await page.goto(`${baseUrl}/p/${paperId}`, { waitUntil: "domcontentloaded" });

  // Let the metadata panel + buttons settle.
  const findBtn = page.getByRole("button", { name: /find citations/i });
  await findBtn.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(1_500);

  await findBtn.click();

  // Extract runs server-side then dispatches refresh event. Wait for the list
  // to render, then keep recording while enrichment fills in the cards
  // (poll ceiling is ~90s; we cap at ~70s of footage).
  const list = page.locator('[data-testid="paper-citations-list"]');
  await list.waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(45_000);
}
