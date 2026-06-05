/**
 * Scene: wow_paper_search
 *
 * Authed via storageState. On a reference detail page (/r/<id>), clicks
 * the "Agentic PDF Search" button and waits for the candidate to surface.
 *
 * Probe findings (2026-05-31):
 *   - [data-testid="reference-agentic-search"] lives on /r/<id> (NOT on the
 *     reader page).
 *   - Click auto-opens the agent panel and submits a hard-coded prompt:
 *     "Find a paper PDF for this reference: <key> Reference ID: <uuid>".
 *   - The agent calls agentic_search_papers and returns a "Candidate found
 *     (match: exact)" message with the open-access PDF URL.
 *
 * Fixture: env TOUR_RECORD_REFERENCE_URL must be a /r/<id> URL whose ref
 *   has no PDF attached.
 */
import type { Page } from "playwright";

export default async function paperSearch(page: Page): Promise<void> {
  const fixture = process.env.TOUR_RECORD_REFERENCE_URL;
  if (!fixture) {
    throw new Error(
      "TOUR_RECORD_REFERENCE_URL must be set to a /r/<id> URL (reference without PDF)",
    );
  }
  await page.goto(fixture, { waitUntil: "domcontentloaded" });

  const btn = page.locator('[data-testid="reference-agentic-search"]').first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(1_500); // beat to let the reader breathe
  await btn.click();

  // Agent panel mounts and auto-submits the search prompt.
  const transcript = page.locator('[data-testid="agent-transcript"]');
  await transcript.waitFor({ state: "visible", timeout: 8_000 });

  // Wait until the candidate result appears (or timeout).
  await page
    .getByText(/Candidate found|No candidate|could not find/i)
    .first()
    .waitFor({ state: "visible", timeout: 45_000 })
    .catch(() => {
      // Don't fail the scene — show whatever streamed in.
    });

  await page.waitForTimeout(3_000); // hold
}
