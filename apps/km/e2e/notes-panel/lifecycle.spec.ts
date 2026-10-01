import { test, expect, type Page } from "@playwright/test";
import {
  caretToEnd,
  createNote,
  editor,
  expectNothingLeftBehind,
  notePicker,
  noteReady,
  openNoteInPanel,
  panel,
  papersWithPdf,
  pdf,
  rectOf,
  setDock,
  slashMenu,
  trashNote,
  type Note,
  type Paper,
} from "./helpers";

// A popup that is open when the panel changes under it must go away with it.
// The slash menu stands in for every caret popup: it is a plain element in
// `body`, so nothing removes it unless the editor does.

const SEED = "A note for the lifecycle checks.\n\nA short last line";

test.describe.configure({ mode: "parallel" });

let paper: Paper;
let note: Note;
let other: Note;

test.beforeAll(async ({ request }) => {
  [paper] = await papersWithPdf(request);
  note = await createNote(request, paper.libraryId, SEED);
  other = await createNote(request, paper.libraryId, "The other note.");
});

test.afterAll(async ({ request }) => {
  await trashNote(request, note);
  await trashNote(request, other);
});

test.beforeEach(async ({ page, request }) => {
  await openNoteInPanel(page, request, paper, note, SEED);
  await caretToEnd(page);
  await page.keyboard.type(" /");
  await expect(slashMenu(page)).toBeVisible();
});

test("closing the panel removes an open popup", async ({ page }) => {
  await panel(page).getByTestId("sidebar-close").click();
  await expect(panel(page)).toHaveCount(0);
  await expectNothingLeftBehind(page);
});

test("changing the dock position removes an open popup", async ({ page }) => {
  await setDock(page, "bottom");
  await expectNothingLeftBehind(page);
  await noteReady(page);
});

async function dragSeparator(page: Page, by: number) {
  const sep = await rectOf(page.locator("#sep-sidebar-notes"));
  const [x, y] = [(sep.left + sep.right) / 2, (sep.top + sep.bottom) / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by, y, { steps: 10 });
  await page.mouse.up();
}

test("dragging the panel separator removes an open popup", async ({ page }) => {
  const before = await rectOf(panel(page));
  await dragSeparator(page, -120);
  const after = await rectOf(panel(page));
  expect(after.right - after.left).toBeGreaterThan(before.right - before.left + 100);
  await expectNothingLeftBehind(page);
});

test("switching notes removes an open popup", async ({ page }) => {
  await page.getByTestId("note-picker-trigger").click();
  await notePicker(page).getByPlaceholder("Search notes...").fill(other.title);
  await notePicker(page).getByRole("option", { name: other.title }).click();
  await expect(page.getByTestId("note-picker-trigger")).toContainText(other.title);
  await expect(editor(page)).toHaveText("The other note.");
  await expectNothingLeftBehind(page);
});

test("a click on the PDF removes an open popup", async ({ page }) => {
  const viewer = await rectOf(page.locator("#pdf-viewer"));
  await page.mouse.click(viewer.left + 40, (viewer.top + viewer.bottom) / 2);
  await expectNothingLeftBehind(page);
  await expect(panel(page)).toBeVisible();
});

test("Escape closes the popup and leaves the panel open", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expectNothingLeftBehind(page);
  await expect(panel(page)).toBeVisible();
  await expect(pdf(page).locator("canvas").first()).toBeVisible();
  // A second Escape, with no popup left to close, still does not close the panel.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeVisible();
  // The caret never left the note.
  await page.keyboard.type("still typing");
  await expect(editor(page).locator("p").last()).toContainText("/still typing");
});
