/**
 * Scene: wow_paper_understanding (NEW)
 *
 * Authed via storageState. Cross-paper Q&A → note creation flow:
 *   1. Open global AgentBall via [data-testid="agent-ball"]
 *   2. Prompt 1: "What does <paper A title> say about <topic>?"
 *   3. Prompt 2 (same thread): "How does this relate to <paper C title>?"
 *   4. Prompt 3: "Create a note titled '<title>' summarizing what you found
 *      with wiki-links to both papers."
 *   5. Wait for note-creation tool to complete + a link to the new note to
 *      appear in the transcript, then click through.
 *
 * Long-running: agent runs three turns + a note create. Cap each turn at
 * 45s. If any turn times out, the scene still emits a usable .webm.
 *
 * Fixture: requires the test workspace to contain >=2 readable papers.
 * Topic strings live here as constants; tweak to match seeded fixtures.
 */
import type { Page } from "playwright";

const PROMPT_1 =
  "What does the protein signalling array paper say about cooperativity?";
const PROMPT_2 =
  "How does that relate to phenotype switching described in other papers in my library?";
const PROMPT_3 =
  "Create a note titled 'Cross-paper insight on cooperativity' summarizing what you found. Wiki-link the papers you cited.";

async function send(page: Page, text: string, timeoutMs = 60_000): Promise<void> {
  const panel = page.locator('[data-testid="agent-panel"]');
  const ta = panel.locator('textarea[placeholder="Ask anything"]').first();
  await ta.waitFor({ state: "visible", timeout: 8_000 });
  await ta.click();
  await ta.type(text, { delay: 18 });
  await panel.getByRole("button", { name: /^send$/i }).first().click();
  // Wait until the streaming indicator stops or a reasonable settle window.
  const idle = page.locator('[data-testid="streaming-indicator"]');
  try {
    await idle.waitFor({ state: "visible", timeout: 5_000 });
    await idle.waitFor({ state: "hidden", timeout: timeoutMs });
  } catch {
    // Either streaming never showed (instant cache) or it ran long; either
    // way fall through after the long wait below.
  }
  await page.waitForTimeout(1_500);
}

export default async function paperUnderstanding(page: Page): Promise<void> {
  const baseUrl = process.env.TOUR_RECORD_BASE_URL ?? "https://tryepisteme.com";
  await page.goto(`${baseUrl}/papers`, { waitUntil: "domcontentloaded" });

  // Open the agent panel via the floating AgentBall.
  const ball = page.locator('[data-testid="agent-ball"]').first();
  await ball.waitFor({ state: "visible", timeout: 10_000 });
  await ball.click();

  await send(page, PROMPT_1, 60_000);
  await send(page, PROMPT_2, 60_000);
  await send(page, PROMPT_3, 90_000);

  // Look for any link to a newly created note (transcript renders a link).
  const noteLink = page
    .locator('[data-testid="agent-transcript"] a[href^="/n/"]')
    .first();
  try {
    await noteLink.waitFor({ state: "visible", timeout: 8_000 });
    await noteLink.click();
    await page.waitForTimeout(4_000); // hold on the opened note
  } catch {
    // No note link surfaced — hold on the transcript for the recording.
    await page.waitForTimeout(3_000);
  }
}
