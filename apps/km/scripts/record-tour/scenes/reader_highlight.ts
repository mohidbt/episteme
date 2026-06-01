/**
 * Scene: wow_reader_highlight
 *
 * Opens a reader page, summons AgentBall via double-space, types a
 * highlight request, waits for highlights to render in the PDF text layer.
 *
 * Stable hooks:
 *   - data-testid="agent-ball"       (FAB; click as fallback if double-space fails)
 *   - data-testid="agent-panel"      (visible when open)
 *   - placeholder="Ask anything"     (prompt textarea)
 *
 * Fixture: env TOUR_RECORD_READER_URL must point at a /r/<id> the test
 * account can read. If unset, scene falls back to /references and opens
 * the first row (best-effort). See README for details.
 */
import type { Page } from "playwright";

export default async function readerHighlight(page: Page): Promise<void> {
  const fixture = process.env.TOUR_RECORD_READER_URL;
  if (fixture) {
    await page.goto(fixture, { waitUntil: "domcontentloaded" });
  } else {
    // Best-effort: pick first reference (caller should set TOUR_RECORD_READER_URL
    // to a paper with a PDF to make this scene deterministic).
    await page.goto(new URL("/references", page.url()).toString(), {
      waitUntil: "domcontentloaded",
    });
    const firstRow = page.locator('[data-testid^="refs-row-"]').first();
    await firstRow.waitFor({ state: "visible", timeout: 10_000 });
    await firstRow.locator("a").first().click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Summon AgentBall via double-space.
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");

  const panel = page.locator('[data-testid="agent-panel"]');
  try {
    await panel.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    // Fallback: click the FAB.
    await page.locator('[data-testid="agent-ball"]').first().click();
    await panel.waitFor({ state: "visible", timeout: 5_000 });
  }

  const prompt = page.getByPlaceholder("Ask anything").first();
  await prompt.click();
  await prompt.type("Highlight numerical findings", { delay: 30 });
  await page.keyboard.press("Enter");

  // Let the agent run + highlights render.
  await page.waitForTimeout(8_000);
  await page.waitForTimeout(2_000); // hold
}
