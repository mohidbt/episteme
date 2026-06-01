/**
 * Scene: wow_deepread
 *
 * Opens a reader page and clicks "Agentic PDF Search", then asks a
 * cross-reference question and waits for the answer + citations.
 *
 * Stable hooks (probed):
 *   - Visible text "Agentic PDF Search" on <ReferenceAgenticSearchButton>
 *     (no data-testid yet — flagged as Round 2 follow-up).
 *   - placeholder="Ask anything" once the agent panel opens.
 *
 * Fixture: env TOUR_RECORD_READER_URL must be a /r/<id> in the test
 * account's workspace.
 */
import type { Page } from "playwright";

export default async function deepread(page: Page): Promise<void> {
  const fixture = process.env.TOUR_RECORD_READER_URL;
  if (!fixture) {
    throw new Error(
      "TOUR_RECORD_READER_URL must be set to a /r/<id> URL in the test workspace",
    );
  }
  await page.goto(fixture, { waitUntil: "domcontentloaded" });

  // No data-testid on the button yet — match by visible text. Stable enough
  // for now; if it shifts, add data-testid="reference-agentic-search" to
  // ReferenceAgenticSearchButton.tsx.
  const btn = page.getByRole("button", { name: /agentic pdf search/i }).first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await btn.click();

  const prompt = page.getByPlaceholder("Ask anything").first();
  await prompt.waitFor({ state: "visible", timeout: 10_000 });
  await prompt.click();
  await prompt.type("What is the architecture of BERT?", { delay: 25 });
  await page.keyboard.press("Enter");

  // Wait for answer + citations to settle.
  await page.waitForTimeout(8_000);
  await page.waitForTimeout(2_000); // hold
}
