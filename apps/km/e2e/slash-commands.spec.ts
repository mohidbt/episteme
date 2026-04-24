import { test } from "@playwright/test";

/**
 * E2E tests for slash commands (phase 1.2).
 *
 * Skipped until tasks 2–4 of phase 1.2 are fully wired (server started,
 * real auth, citation data seeded). Un-skip when the full phase lands.
 */

test.describe.skip("/cite slash command", () => {
  test("/cite trans — pick Transformers paper → [1] appears at cursor, bibliography at bottom", async ({
    page,
  }) => {
    // 1. Log in as test user with seeded library data containing "Attention Is All You Need"
    // await page.goto("/login"); ... authenticate ...

    // 2. Navigate to a note
    // await page.goto("/n/some-test-note");

    // 3. Click into the editor, type "/cite trans"
    // const editor = page.locator('[data-testid="note-editor"] .ProseMirror');
    // await editor.click();
    // await page.keyboard.type("/cite trans");

    // 4. Wait for the slash typeahead to show the "Cite" entry,
    //    then for the citation sub-menu to show Transformers results
    // await expect(page.locator('text=Attention Is All You Need')).toBeVisible();

    // 5. Press Enter to pick the paper
    // await page.keyboard.press("Enter");

    // 6. Assert [1] appears inline at cursor position
    // await expect(editor.locator('[data-type="citation"]')).toHaveText("[@vaswani2017]");

    // 7. Assert bibliography section appears at the bottom of the note
    // await expect(editor.locator('text=Bibliography')).toBeVisible();
    // await expect(editor.locator('ol li')).toContainText("Vaswani");
  });
});
