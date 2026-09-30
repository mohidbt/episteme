import { test, expect } from "@playwright/test";
import {
  DOCKS,
  SIZES,
  VIEWPORTS,
  caretToEnd,
  createNote,
  editor,
  expectNoHorizontalOverflow,
  expectNothingLeftBehind,
  expectPopupSane,
  lastWordOfFirstLine,
  linkPopover,
  markBodyBaseline,
  notePicker,
  noteReady,
  openReader,
  panel,
  papersWithPdf,
  rectOf,
  screenshot,
  selectionRect,
  selectionToolbar,
  setDock,
  setNoteContent,
  setSize,
  slashMenu,
  tableMenu,
  trashNote,
  wikiMenu,
  type Note,
  type Paper,
} from "./helpers";

// Every editor popup, in every dock position, at every panel size, in three
// window sizes: each one has to open where a user expects it and leave
// nothing behind.

const SEED = [
  "The first paragraph of the matrix note is long enough to wrap onto a second line in a narrow panel, which puts text at both edges of the panel.",
  "A short last line",
].join("\n\n");

test.describe.configure({ mode: "parallel" });

let paper: Paper;
let note: Note;

test.beforeAll(async ({ request }) => {
  [paper] = await papersWithPdf(request);
  note = await createNote(request, paper.libraryId, SEED);
});

test.afterAll(async ({ request }) => {
  await trashNote(request, note);
});

for (const viewport of VIEWPORTS) {
  for (const dock of DOCKS) {
    for (const size of SIZES) {
      const cell = `${viewport.width}x${viewport.height}-${dock}-${size}`;

      test(`popups at ${viewport.width}x${viewport.height}, dock ${dock}, size ${size}`, async ({ page, request }) => {
        await setNoteContent(request, note, SEED);
        await page.setViewportSize(viewport);
        await openReader(page, paper, { noteId: note.id, open: true });
        await noteReady(page);
        if (dock !== "right") {
          await setDock(page, dock);
          await noteReady(page);
        }
        await setSize(page, dock, size);
        await markBodyBaseline(page);
        await expectNoHorizontalOverflow(page);

        await test.step("slash menu", async () => {
          await caretToEnd(page);
          await page.keyboard.type(" /");
          await expectPopupSane(slashMenu(page), await selectionRect(page), "slash menu");
          await screenshot(page, `${cell}-slash-menu`);
          await page.keyboard.press("Escape");
          await expectNothingLeftBehind(page);
          await expect(panel(page)).toBeVisible();
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

        let selection = await selectionRect(page);

        await test.step("selection toolbar", async () => {
          const word = await lastWordOfFirstLine(editor(page).locator("p").first());
          await page.mouse.dblclick(word.x, word.y);
          selection = await selectionRect(page);
          await expectPopupSane(selectionToolbar(page), selection, "selection toolbar");
          await screenshot(page, `${cell}-selection-toolbar`);
        });

        await test.step("link popover", async () => {
          await selectionToolbar(page).getByRole("button", { name: "Insert link" }).click();
          await expectPopupSane(linkPopover(page), selection, "link popover");
          await expect(selectionToolbar(page)).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(linkPopover(page)).toHaveCount(0);
          // Focus is back in the note, so the selection has its toolbar again.
          await expect(selectionToolbar(page)).toBeVisible();
          await page.keyboard.press("ArrowRight");
          await expectNothingLeftBehind(page);
        });

        await test.step("table menu", async () => {
          await caretToEnd(page);
          await page.keyboard.press("Enter");
          await page.keyboard.type("/table");
          await expect(slashMenu(page)).toContainText("Insert a 3×3 table");
          await page.keyboard.press("Enter");
          const table = editor(page).locator(".tableWrapper");
          await expect(table).toBeVisible();
          await expectPopupSane(tableMenu(page), await rectOf(table), "table menu");
          await expectNoHorizontalOverflow(page);
          await screenshot(page, `${cell}-table-menu`);
          await tableMenu(page).getByTitle("Delete table").click();
          await expect(table).toHaveCount(0);
          // The pointer is still where the menu was: move it off the note.
          await page.mouse.move(0, 0);
          await expectNothingLeftBehind(page);
        });

        await test.step("note picker", async () => {
          const trigger = page.getByTestId("note-picker-trigger");
          await trigger.click();
          await expect(notePicker(page)).toContainText(note.title);
          await expectPopupSane(notePicker(page), await rectOf(trigger), "note picker");
          await screenshot(page, `${cell}-note-picker`);
          await page.keyboard.press("Escape");
          await expectNothingLeftBehind(page);
          await expect(panel(page)).toBeVisible();
        });

        await expectNoHorizontalOverflow(page);
        await noteReady(page);
      });
    }
  }
}
