/**
 * Scene: wow_reader_highlight (EXTENDED flow)
 *
 * Authed via storageState. On a reader page:
 *   1. Open agent sidebar via [data-testid="reader-toolbar-agent"]
 *   2. Type "Highlight numerical findings" into the agent textarea
 *   3. Wait for the agent to propose highlights (Approval required: highlight)
 *   4. Click Approve
 *   5. Wait for highlights to land in [data-testid="sidebar-highlights"]
 *
 * Probe findings (2026-05-31):
 *   - Reader uses [data-testid="reader-toolbar-agent"] to open the agent
 *     sidebar (NOT the global AgentBall). When open, the sidebar's testid is
 *     [data-testid="sidebar-agent"] containing a single textarea with
 *     placeholder="Ask anything" and a "Send" button.
 *   - The agent calls read_paper (Approval required: highlight) and renders
 *     an Approve / Reject / Edit set of buttons.
 *   - On Approve, the highlight run lands in [data-testid="sidebar-highlights"]
 *     with a "1 of N" stepper.
 *
 * Fixture: env TOUR_RECORD_READER_URL must be a /papers/<id>/read URL.
 */
import type { Page } from "playwright";

export default async function readerHighlight(page: Page): Promise<void> {
  const fixture = process.env.TOUR_RECORD_READER_URL;
  if (!fixture) {
    throw new Error(
      "TOUR_RECORD_READER_URL must be set to a /papers/<id>/read URL",
    );
  }
  await page.goto(fixture, { waitUntil: "domcontentloaded" });

  // Open agent sidebar from reader toolbar.
  const toolbarAgent = page.locator('[data-testid="reader-toolbar-agent"]');
  await toolbarAgent.waitFor({ state: "visible", timeout: 15_000 });
  await toolbarAgent.click();

  const sidebar = page.locator('[data-testid="sidebar-agent"]');
  await sidebar.waitFor({ state: "visible", timeout: 8_000 });
  const prompt = sidebar.locator('textarea[placeholder="Ask anything"]').first();
  await prompt.waitFor({ state: "visible", timeout: 8_000 });
  await prompt.click();
  await prompt.type("Highlight numerical findings", { delay: 30 });
  // Submit via Send button (Enter on textarea inserts newline).
  await sidebar.getByRole("button", { name: /^send$/i }).first().click();

  // Wait for the Approve button to appear (agent proposed highlights).
  const approve = sidebar.getByRole("button", { name: /^approve$/i }).first();
  await approve.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1_500); // beat for the viewer
  await approve.click();

  // Wait for highlights to render in the highlights sidebar.
  const hls = page.locator('[data-testid="sidebar-highlights"]');
  await hls.waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(5_000); // let cells settle + stepper appear
  await page.waitForTimeout(2_000); // hold
}
