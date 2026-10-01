import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  caretToEnd,
  createNote,
  editor,
  noteContent,
  noteReady,
  openReader,
  panel,
  panelBody,
  papersWithPdf,
  pdf,
  screenshot,
  trashNote,
  type Paper,
} from "./helpers";

// The panel from a reader's point of view: start a note, pick one, come back
// to it, and see each paper keep its own.

test.describe.configure({ mode: "parallel" });
test.use({ viewport: { width: 1440, height: 900 } });

let papers: Paper[];

test.beforeAll(async ({ request }) => {
  papers = await papersWithPdf(request);
});

const trigger = (page: Page) => page.getByTestId("note-picker-trigger");
/** The picker shown in the panel itself while no note is chosen. */
const emptyState = (page: Page) => panelBody(page).getByTestId("note-picker");
const sidebar = (page: Page) => page.locator('[data-slot="sidebar"]');

/** What this browser remembers for a paper. */
const remembered = (page: Page, paper: Paper): Promise<{ noteId: string | null; open: boolean }> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), `reader-notes:v1:${paper.id}`);

/** Open the sidebar's Drive tree down to the paper's folder. */
async function expandDriveTo(page: Page, request: APIRequestContext, paper: Paper) {
  const tree = await (await request.get(`/api/tree?libraryId=${paper.libraryId}`)).json();
  const names: string[] = [];
  for (let id = paper.folderId; id; ) {
    const folder = tree.folders.find((f: { id: string }) => f.id === id);
    names.unshift(folder.name);
    id = folder.parentId;
  }
  for (const name of ["Drive", ...names]) {
    const row = sidebar(page).getByRole("button", { name, exact: true }).first();
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  }
}

test("New note: titled after the paper, in its folder, in the sidebar, focused", async ({ page, request }) => {
  const [paper] = papers;
  await openReader(page, paper);
  await expandDriveTo(page, request, paper);

  await expect(panel(page)).toHaveCount(0);
  await page.getByTestId("reader-toolbar-notes").click();
  await expect(trigger(page)).toHaveText("Choose a note");
  await expect(emptyState(page)).toBeVisible();
  await screenshot(page, "flows-empty-state");

  await emptyState(page).getByRole("option", { name: "New note" }).click();
  await expect(editor(page)).toBeFocused();
  const { noteId } = await remembered(page, paper);
  try {
    await expect(trigger(page)).toHaveText(paper.title);
    const created = await (await request.get(`/api/notes/${noteId}`)).json();
    expect(created.title).toBe(paper.title);
    expect(created.folderId).toBe(paper.folderId);
    // In the sidebar's tree without a reload.
    await expect(sidebar(page).locator(`a[href="/n/${created.slug}"]`)).toBeVisible();

    await page.keyboard.type("A first thought.");
    await expect(editor(page)).toHaveText("A first thought.");
    await expect.poll(() => noteContent(request, { id: noteId! })).toContain("A first thought.");
    await screenshot(page, "flows-new-note");
  } finally {
    await trashNote(request, { id: noteId!, libraryId: paper.libraryId });
  }
});

test("an existing note is picked by searching for it", async ({ page, request }) => {
  const [paper] = papers;
  const note = await createNote(request, paper.libraryId, "Found by its title.");
  try {
    await openReader(page, paper, { noteId: null, open: true });
    await emptyState(page).getByPlaceholder("Search notes...").fill(note.title);
    await expect(emptyState(page).getByRole("option")).toHaveCount(2);
    await emptyState(page).getByRole("option", { name: note.title }).click();

    await expect(editor(page)).toHaveText("Found by its title.");
    await expect(editor(page)).toBeFocused();
    await expect(trigger(page)).toHaveText(note.title);
    expect(await remembered(page, paper)).toEqual({ noteId: note.id, open: true });
  } finally {
    await trashNote(request, note);
  }
});

test("typing survives a reload, and each paper keeps its own note", async ({ page, request }) => {
  const [first, second] = papers;
  const note = await createNote(request, first.libraryId, "Kept across visits.");
  const text = "Kept across visits. Typed in the panel.";
  try {
    await openReader(page, first, { noteId: note.id, open: true });
    await noteReady(page);
    await caretToEnd(page);
    await page.keyboard.type(" Typed in the panel.");
    await expect.poll(() => noteContent(request, note)).toContain("Typed in the panel.");

    await page.reload();
    await expect(editor(page)).toHaveText(text);
    await expect(trigger(page)).toHaveText(note.title);
    // A note that was only restored does not take the keyboard from the PDF.
    await expect(pdf(page).locator("canvas").first()).toBeVisible();
    await expect(editor(page)).not.toBeFocused();

    await test.step("a second paper starts empty", async () => {
      await page.goto(`/papers/${second.id}/read`);
      await expect(page.getByTestId("reader-toolbar-notes")).toBeVisible();
      await expect(panel(page)).toHaveCount(0);
      await page.getByTestId("reader-toolbar-notes").click();
      await expect(trigger(page)).toHaveText("Choose a note");
      await expect(emptyState(page)).toBeVisible();
      await expect(editor(page)).toHaveCount(0);
    });

    await test.step("the first paper still has its note", async () => {
      await page.goto(`/papers/${first.id}/read`);
      await expect(editor(page)).toHaveText(text);
      await expect(trigger(page)).toHaveText(note.title);
    });
  } finally {
    await trashNote(request, note);
  }
});

test("a remembered note that was trashed gives way to the empty state", async ({ page, request }) => {
  const [paper] = papers;
  const note = await createNote(request, paper.libraryId, "About to be trashed.");
  await openReader(page, paper, { noteId: note.id, open: true });
  await noteReady(page);
  await trashNote(request, note);

  await page.reload();
  await expect(trigger(page)).toHaveText("Choose a note");
  await expect(emptyState(page)).toBeVisible();
  await expect.poll(() => remembered(page, paper)).toEqual({ noteId: null, open: true });
  // The trash is not offered as something to pick.
  await emptyState(page).getByPlaceholder("Search notes...").fill(note.title);
  await expect(emptyState(page)).toContainText("No notes found.");
});

test("Open in tab shows the same note on its own page", async ({ page, request }) => {
  const [paper] = papers;
  const note = await createNote(request, paper.libraryId, "Opened from the panel.");
  try {
    await openReader(page, paper, { noteId: note.id, open: true });
    await noteReady(page);
    await caretToEnd(page);
    await page.keyboard.type(" With a line typed there.");
    await expect.poll(() => noteContent(request, note)).toContain("With a line typed there.");

    await page.getByTestId("reader-notes-open-in-tab").click();
    const tab = page.locator(`[data-testid="tab-bar-tab"][data-href="/n/${note.slug}"]`);
    await expect(tab).toBeVisible();
    // A background tab: the reader stays where it is.
    expect(new URL(page.url()).pathname).toBe(`/papers/${paper.id}/read`);
    await expect(editor(page)).toBeVisible();

    await tab.click();
    await expect(page).toHaveURL(new RegExp(`/n/${note.slug}$`));
    await expect(page.getByTestId("note-title")).toHaveValue(note.title);
    await expect(page.locator(".ProseMirror")).toHaveText("Opened from the panel. With a line typed there.");
  } finally {
    await trashNote(request, note);
  }
});
