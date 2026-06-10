/**
 * Scene: wow_citations
 *
 * Already authed (storageState). Navigates to /p/<paperId> for a fresh paper
 * that already has citations extracted. The right rail renders highlights
 * ABOVE citations, so the scene scrolls the citations panel into view so the
 * viewer can actually see [data-testid="paper-citations-list"] (prior take
 * recorded only the highlights row at top of rail).
 *
 * Stable hooks:
 *   - data-testid="paper-citations-section" (wrapping section, scroll target)
 *   - data-testid="paper-citations-list"    (rendered list)
 *   - data-testid="citations-enriching"     (loader badge while polling)
 *
 * Env:
 *   TOUR_RECORD_CITATIONS_PAPER_ID  required — paper UUID w/ citations populated
 */
import type { Page } from "playwright";

export default async function citations(page: Page): Promise<void> {
  const baseUrl = process.env.TOUR_RECORD_BASE_URL ?? "https://tryepisteme.com";
  const paperId = process.env.TOUR_RECORD_CITATIONS_PAPER_ID;
  if (!paperId) {
    throw new Error("TOUR_RECORD_CITATIONS_PAPER_ID required for citations scene");
  }

  await page.goto(`${baseUrl}/p/${paperId}`, { waitUntil: "domcontentloaded" });

  // Wait for the citations section to mount + Find button to be ready.
  const section = page.locator('[data-testid="paper-citations-section"]');
  await section.waitFor({ state: "visible", timeout: 20_000 });

  const findBtn = page.getByRole("button", { name: /find citations/i });
  await findBtn.waitFor({ state: "visible", timeout: 15_000 });

  // Beat on top-of-page so the viewer registers context (paper meta +
  // highlights row) before we pan down to citations.
  await page.waitForTimeout(2_000);

  // Scroll the citations section into the center of the right-rail scroll
  // container BEFORE clicking, so the "Find citations" click + the populating
  // list happen on-camera. The rail is an ASIDE with overflow-y-auto;
  // scrollIntoView walks up and scrolls it (not the window).
  await section.evaluate((el) => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  await page.waitForTimeout(1_500); // let smooth-scroll settle

  // Trigger extraction. Server dispatches refresh event → list mounts.
  await findBtn.click();

  // Re-scroll once list mounts — extracted rows extend the section, so
  // re-center to keep the populated list in frame.
  const list = page.locator('[data-testid="paper-citations-list"]');
  await list.waitFor({ state: "visible", timeout: 60_000 });
  await section.evaluate((el) => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  await page.waitForTimeout(1_000);

  // Hold while enrichment cards animate in (poll ceiling ~90s; cap footage
  // at ~45s).
  await page.waitForTimeout(45_000);
}
