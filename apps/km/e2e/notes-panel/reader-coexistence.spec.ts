import { test, expect, type Page } from "@playwright/test";
import {
  caretToEnd,
  createNote,
  editor,
  expectNoHorizontalOverflow,
  expectNothingLeftBehind,
  expectPopupSane,
  noteReady,
  openNoteInPanel,
  panel,
  papersWithPdf,
  pdf,
  pdfSelectionToolbar,
  pointOfText,
  rectOf,
  screenshot,
  selectionRect,
  selectionToolbar,
  setDock,
  slashMenu,
  trashNote,
  type Note,
  type Paper,
  type Rect,
} from "./helpers";

// The panel is a guest in the reader: the PDF keeps scrolling and selecting,
// the two selection toolbars stay out of each other's way, typing a note
// never reaches the PDF, and the Agent panel can be open next to it.

const SEED = "Notes taken while reading.\n\nA short last line";

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

test.beforeEach(async ({ page, request }) => {
  await openNoteInPanel(page, request, paper, note, SEED);
});

const pdfScrollTop = (page: Page) => pdf(page).evaluate((el) => el.scrollTop);

async function scrollPdf(page: Page, by: number) {
  const viewer = await rectOf(page.locator("#pdf-viewer"));
  await page.mouse.move((viewer.left + viewer.right) / 2, (viewer.top + viewer.bottom) / 2);
  const before = await pdfScrollTop(page);
  await page.mouse.wheel(0, by);
  await expect.poll(() => pdfScrollTop(page)).toBe(before + by);
}

/**
 * Drag over the start of a line of PDF text that is fully in view and not
 * under a link annotation (dragging a link drags the link).
 */
async function selectPdfText(page: Page) {
  const line = await pdf(page).evaluate((container) => {
    const view = container.getBoundingClientRect();
    for (const span of container.querySelectorAll(".react-pdf__Page__textContent span")) {
      const r = span.getBoundingClientRect();
      const inView = r.top > view.top + 80 && r.bottom < view.bottom - 80 && r.left > view.left && r.right < view.right;
      const y = r.top + r.height / 2;
      const plain = [r.left + 4, r.left + 140].every((x) => document.elementFromPoint(x, y) === span);
      if (inView && plain && r.width > 160 && span.textContent!.trim().length > 20) return { x: r.left, y };
    }
    throw new Error("no line of PDF text in view");
  });
  await page.mouse.move(line.x + 4, line.y);
  await page.mouse.down();
  await page.mouse.move(line.x + 140, line.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => getSelection()!.toString().trim().length)).toBeGreaterThan(3);
}

test("the PDF scrolls and selects, and each selection gets only its own toolbar", async ({ page }) => {
  await scrollPdf(page, 400);

  await test.step("a selection in the PDF", async () => {
    await selectPdfText(page);
    await expect(pdfSelectionToolbar(page)).toBeVisible();
    await expect(selectionToolbar(page)).toHaveCount(0);
    await screenshot(page, "coexistence-pdf-selection");
  });

  await test.step("a selection in the note", async () => {
    const word = await pointOfText(editor(page).locator("p").first(), "taken");
    await page.mouse.dblclick(word.x, word.y);
    await expectPopupSane(selectionToolbar(page), await selectionRect(page), "selection toolbar");
    await expect(pdfSelectionToolbar(page)).toHaveCount(0);
    await screenshot(page, "coexistence-note-selection");
  });

  await test.step("back to the PDF", async () => {
    await selectPdfText(page);
    await expect(pdfSelectionToolbar(page)).toBeVisible();
    await expect(selectionToolbar(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(pdfSelectionToolbar(page)).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });
});

test("typing in the note never scrolls the PDF or fires a shortcut", async ({ page }) => {
  await scrollPdf(page, 400);
  const before = await pdfScrollTop(page);

  await caretToEnd(page);
  // Two spaces in a row are the app's shortcut for the agent outside a text field.
  await page.keyboard.type(" typed with  two spaces");
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Space", "PageDown", "PageUp"]) {
    await page.keyboard.press(key);
  }

  await expect(editor(page)).toContainText("typed with two spaces");
  expect(await pdfScrollTop(page)).toBe(before);
  await expect(page.getByTestId("agent-panel")).toBeHidden();
  await expect(page.locator("#sidebar-agent")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/papers/${paper.id}/read`);
  await expect(panel(page)).toBeVisible();
});

const apart = (a: Rect, b: Rect) =>
  a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;

/** Notes, Agent and the PDF each have their own room, and the note's popups still work. */
async function expectSideBySide(page: Page, label: string) {
  const [notes, agent, viewer] = [
    await rectOf(panel(page)),
    await rectOf(page.locator("#sidebar-agent")),
    await rectOf(page.locator("#pdf-viewer")),
  ];
  const where = JSON.stringify({ notes, agent, viewer });
  expect(apart(notes, agent), `notes and agent overlap: ${where}`).toBe(true);
  expect(apart(notes, viewer), `notes and PDF overlap: ${where}`).toBe(true);
  expect(apart(agent, viewer), `agent and PDF overlap: ${where}`).toBe(true);
  expect(viewer.right - viewer.left, `the PDF keeps a usable width: ${where}`).toBeGreaterThan(300);
  await expect(pdf(page).locator("canvas").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await caretToEnd(page);
  await page.keyboard.type(" /");
  await expectPopupSane(slashMenu(page), await selectionRect(page), `slash menu, ${label}`);
  await screenshot(page, `coexistence-${label}`);
  await page.keyboard.press("Escape");
  await expectNothingLeftBehind(page);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
}

test("Notes and Agent are open together, in the same dock and in different docks", async ({ page }) => {
  await page.getByTestId("reader-toolbar-agent").click();
  // Opening the agent focuses its composer once that has loaded; wait for it
  // so the focus move does not land in the middle of typing in the note.
  await expect(page.locator("#sidebar-agent .episteme-chat-composer")).toBeFocused();
  await expectSideBySide(page, "agent-right-notes-right");

  for (const dock of ["left", "bottom"] as const) {
    await setDock(page, dock);
    await noteReady(page);
    await expect(page.locator("#sidebar-agent")).toBeVisible();
    await expectSideBySide(page, `agent-right-notes-${dock}`);
  }
});
