import { test, expect, type Page } from "@playwright/test";
import {
  caretToEnd,
  createNote,
  expectAiOutput,
  expectNothingLeftBehind,
  expectPopupSane,
  generatePanel,
  lastWordOfFirstLine,
  linkPopover,
  markBodyBaseline,
  papersWithPdf,
  rectOf,
  rephraseBubble,
  screenshot,
  selectionRect,
  selectionToolbar,
  setNoteContent,
  slashMenu,
  tableMenu,
  trashNote,
  wikiMenu,
  type Note,
} from "./helpers";

// The panel work touched the editor's popups, which the full note page shares.
// The same checks once on `/n/<slug>`: nothing there may have moved.

test.use({ viewport: { width: 1440, height: 900 } });

let note: Note;
let target: Note;

test.beforeAll(async ({ request }) => {
  const [paper] = await papersWithPdf(request);
  target = await createNote(request, paper.libraryId, "The linked note.");
  note = await createNote(request, paper.libraryId);
});

test.afterAll(async ({ request }) => {
  await trashNote(request, note);
  await trashNote(request, target);
});

const editor = (page: Page) => page.locator(".ProseMirror");

async function openNotePage(page: Page, slug: string) {
  await page.goto(`/n/${slug}`);
  await expect(editor(page)).toBeVisible();
  await markBodyBaseline(page);
}

test("editor popups on the full note page", async ({ page, request }) => {
  const paragraphs = [
    "The note page gives the editor the full width of the window, and its popups open where they always did.",
    "A short last line",
  ];
  await setNoteContent(request, note, paragraphs.join("\n\n"));
  await openNotePage(page, note.slug);

  await test.step("slash menu", async () => {
    await caretToEnd(page, editor(page));
    await page.keyboard.type(" /");
    await expectPopupSane(slashMenu(page), await selectionRect(page), "slash menu");
    await screenshot(page, "note-page-slash-menu");
    await page.keyboard.press("Escape");
    await expectNothingLeftBehind(page);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
  });

  await test.step("[[ typeahead", async () => {
    await page.keyboard.type(" [[");
    await expectPopupSane(wikiMenu(page), await selectionRect(page), "[[ typeahead");
    await page.keyboard.type("e2e");
    await expect(wikiMenu(page)).toContainText(/Notes|Press Enter to create/);
    await expectPopupSane(wikiMenu(page), await selectionRect(page), "[[ typeahead with results");
    await page.keyboard.press("Escape");
    await expectNothingLeftBehind(page);
    for (let i = 0; i < " [[e2e".length; i++) await page.keyboard.press("Backspace");
  });

  await test.step("selection toolbar and link popover", async () => {
    const word = await lastWordOfFirstLine(editor(page).locator("p").first());
    await page.mouse.dblclick(word.x, word.y);
    const selection = await selectionRect(page);
    await expectPopupSane(selectionToolbar(page), selection, "selection toolbar");
    await screenshot(page, "note-page-selection-toolbar");
    await selectionToolbar(page).getByRole("button", { name: "Insert link" }).click();
    await expectPopupSane(linkPopover(page), selection, "link popover");
    await expect(selectionToolbar(page)).toHaveCount(0);
    await screenshot(page, "note-page-link-popover");
    await page.keyboard.press("Escape");
    await expect(linkPopover(page)).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expectNothingLeftBehind(page);
  });

  await test.step("AI rewrite", async () => {
    await caretToEnd(page, editor(page));
    await page.keyboard.press("Enter");
    await page.keyboard.type("/ai");
    await expect(slashMenu(page)).toContainText("Ask AI to write or edit");
    const line = await selectionRect(page);
    await page.keyboard.press("Enter");
    await expectPopupSane(generatePanel(page), line, "generate panel, prompting");
    await page.keyboard.type("Write one short sentence about reading papers.");
    await page.keyboard.press("Enter");
    await expectAiOutput(generatePanel(page));
    await expectPopupSane(generatePanel(page), line, "generate panel, with output");
    await screenshot(page, "note-page-ai-generate-output");
    const before = await editor(page).innerText();
    await generatePanel(page).getByRole("button", { name: "Insert" }).click();
    await expectNothingLeftBehind(page);
    await expect.poll(() => editor(page).innerText()).not.toBe(before);

    const first = editor(page).locator("p").first();
    await first.click({ clickCount: 3 });
    const selection = await selectionRect(page);
    await selectionToolbar(page).getByRole("button", { name: "AI Rephrase" }).click();
    await expectPopupSane(rephraseBubble(page), selection, "rephrase panel, prompting");
    await page.keyboard.type("Say this in completely different words.");
    await page.keyboard.press("Enter");
    await expectAiOutput(rephraseBubble(page));
    await expectPopupSane(rephraseBubble(page), selection, "rephrase panel, with output");
    await screenshot(page, "note-page-ai-rephrase-output");
    await rephraseBubble(page).getByRole("button", { name: "Replace" }).click();
    await expect(first).not.toHaveText(paragraphs[0]);
    await expectNothingLeftBehind(page);
  });

  await test.step("table menu", async () => {
    await caretToEnd(page, editor(page));
    await page.keyboard.press("Enter");
    await page.keyboard.type("/table");
    await expect(slashMenu(page)).toContainText("Insert a 3×3 table");
    await page.keyboard.press("Enter");
    const table = editor(page).locator(".tableWrapper");
    await expectPopupSane(tableMenu(page), await rectOf(table), "table menu");
    await screenshot(page, "note-page-table-menu");
    await tableMenu(page).getByTitle("Delete table").click();
    await expect(table).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expectNothingLeftBehind(page);
  });
});

test("a wiki link on the note page navigates in the current tab", async ({ page, request }) => {
  await setNoteContent(request, note, `See [[${target.title}]] for the rest.`);
  await openNotePage(page, note.slug);
  await editor(page).locator('[data-type="wiki-link"]').click();
  await expect(page).toHaveURL(new RegExp(`/n/${target.slug}$`));
  await expect(editor(page)).toHaveText("The linked note.");
});
