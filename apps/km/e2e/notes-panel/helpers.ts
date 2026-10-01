import path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { SCREENSHOT_DIR } from "../../playwright.config";

export type Dock = "right" | "left" | "bottom";
export type Size = "minimum" | "default" | "large";
export type Rect = { top: number; bottom: number; left: number; right: number };
export type Paper = { id: string; title: string; libraryId: number; folderId: string | null };
export type Note = { id: string; title: string; slug: string; libraryId: number };

export const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
export const DOCKS: Dock[] = ["right", "left", "bottom"];
export const SIZES: Size[] = ["minimum", "default", "large"];

/** Every note the suite creates carries this prefix, so leftovers are easy to find. */
export const NOTE_PREFIX = "e2e-notes-panel-";

// ── account data ────────────────────────────────────────────────────────────

/**
 * The account's titled papers that have a PDF and are not in the trash,
 * smallest first. Papers with AI highlights are left out: the reader opens
 * its Highlights panel for them on load, which would crowd every dock.
 */
export async function papersWithPdf(request: APIRequestContext): Promise<Paper[]> {
  const [library] = await (await request.get("/api/libraries")).json();
  const tree = await (await request.get(`/api/tree?libraryId=${library.id}`)).json();
  const trash = new Set(
    tree.folders.filter((f: { isTrash: boolean }) => f.isTrash).map((f: { id: string }) => f.id),
  );
  const all: (Paper & { sizeBytes: number })[] = await (
    await request.get(`/api/papers?libraryId=${library.id}`)
  ).json();
  const papers: Paper[] = [];
  for (const paper of all.sort((a, b) => a.sizeBytes - b.sizeBytes)) {
    if (!paper.title || !paper.sizeBytes || trash.has(paper.folderId)) continue;
    const highlights = await (await request.get(`/api/paper-highlights?paperId=${paper.id}`)).json();
    if (highlights.length === 0) papers.push(paper);
  }
  expect(papers.length, "the account needs two quiet papers with a PDF").toBeGreaterThanOrEqual(2);
  return papers;
}

export async function setNoteContent(request: APIRequestContext, note: Note, contentMd: string) {
  const res = await request.patch(`/api/notes/${note.id}/content`, { data: { contentMd } });
  expect(res.status(), await res.text()).toBe(204);
}

export async function createNote(
  request: APIRequestContext,
  libraryId: number,
  contentMd = "",
): Promise<Note> {
  // The worker index keeps titles apart when two workers create in the same millisecond.
  const title = `${NOTE_PREFIX}${Date.now()}-${test.info().parallelIndex}`;
  const res = await request.post("/api/notes", { data: { libraryId, folderId: null, title } });
  expect(res.status(), await res.text()).toBe(201);
  const note = { ...(await res.json()), libraryId } as Note;
  if (contentMd) await setNoteContent(request, note, contentMd);
  return note;
}

export async function trashNote(request: APIRequestContext, note: Pick<Note, "id" | "libraryId">) {
  const res = await request.post("/api/folders/trash", {
    data: { libraryId: note.libraryId, target: { kind: "note", id: note.id } },
  });
  expect(res.status(), await res.text()).toBe(204);
}

export async function noteContent(request: APIRequestContext, note: Pick<Note, "id">): Promise<string> {
  return (await (await request.get(`/api/notes/${note.id}`)).json()).contentMd;
}

// ── reader and panel ────────────────────────────────────────────────────────

export const panel = (page: Page) => page.getByTestId("reader-notes-panel");
export const panelBody = (page: Page) => page.getByTestId("reader-notes-body");
export const editor = (page: Page) => panelBody(page).locator(".ProseMirror");
export const pdf = (page: Page) => page.locator("[data-pdf-container]");

/**
 * Open a paper in the reader. `remembered` seeds the paper's notes-panel
 * memory once, before the app reads it, so a test can start with a note
 * already in the panel.
 */
export async function openReader(
  page: Page,
  paper: Paper,
  remembered?: { noteId: string | null; open: boolean },
) {
  if (remembered) {
    await page.addInitScript(
      ([key, value]) => {
        if (sessionStorage.getItem("e2e-seeded")) return;
        sessionStorage.setItem("e2e-seeded", "1");
        localStorage.setItem(key, value);
      },
      [`reader-notes:v1:${paper.id}`, JSON.stringify(remembered)],
    );
  }
  await page.goto(`/papers/${paper.id}/read`);
  await expect(page.getByTestId("reader-toolbar-notes")).toBeVisible();
  await expect(pdf(page).locator("canvas").first()).toBeVisible({ timeout: 60_000 });
}

/** The note is loaded in the panel and nothing is waiting to be saved. */
export async function noteReady(page: Page) {
  await expect(editor(page)).toBeVisible();
  await expect(page.getByTestId("reader-notes-sync")).toHaveAttribute("data-sync-status", "synced");
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

export async function setDock(page: Page, dock: Dock) {
  await panel(page).getByTestId("dock-menu-trigger").click();
  await panel(page).getByTestId(`dock-menu-item-${dock}`).click();
  await expect(async () => {
    const [p, viewer] = [await box(panel(page)), await box(page.locator("#pdf-viewer"))];
    if (dock === "right") expect(p.x).toBeGreaterThanOrEqual(viewer.x + viewer.width);
    if (dock === "left") expect(p.x + p.width).toBeLessThanOrEqual(viewer.x);
    if (dock === "bottom") expect(p.y).toBeGreaterThanOrEqual(viewer.y + viewer.height);
  }).toPass();
}

/**
 * Drag the panel's separator as far as it goes: to the panel's minimum, or
 * to the largest size the reader allows. Returns the panel's resulting extent
 * along the dragged axis.
 */
export async function setSize(page: Page, dock: Dock, size: Size): Promise<number> {
  const extent = async () => {
    const p = await box(panel(page));
    return dock === "bottom" ? p.height : p.width;
  };
  if (size === "default") return extent();
  const before = await extent();
  const viewport = page.viewportSize()!;
  const sep = await box(page.locator(dock === "bottom" ? "#sep-bottom" : "#sep-sidebar-notes"));
  const from = { x: sep.x + sep.width / 2, y: sep.y + sep.height / 2 };
  const grow = size === "large";
  const to =
    dock === "bottom"
      ? { x: from.x, y: grow ? 1 : viewport.height - 1 }
      : { x: (dock === "right") === grow ? 1 : viewport.width - 1, y: from.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 25 });
  await page.mouse.up();
  const after = await extent();
  if (grow) expect(after, "large is larger than default").toBeGreaterThan(before + 50);
  else expect(after, "minimum size").toBeLessThanOrEqual((dock === "bottom" ? 240 : 360) + 2);
  return after;
}

/**
 * Open `note` in the paper's notes panel with `contentMd` as its text, at a
 * window size, dock position and panel size. Defaults to the narrowest
 * panel: docked right, dragged to its minimum, in a 1440x900 window.
 */
export async function openNoteInPanel(
  page: Page,
  request: APIRequestContext,
  paper: Paper,
  note: Note,
  contentMd: string,
  at: { viewport?: { width: number; height: number }; dock?: Dock; size?: Size } = {},
) {
  const { viewport = VIEWPORTS[1], dock = "right", size = "minimum" } = at;
  await setNoteContent(request, note, contentMd);
  await page.setViewportSize(viewport);
  await openReader(page, paper, { noteId: note.id, open: true });
  await noteReady(page);
  if (dock !== "right") {
    await setDock(page, dock);
    await noteReady(page);
  }
  await setSize(page, dock, size);
  await markBodyBaseline(page);
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

// ── editor ──────────────────────────────────────────────────────────────────

/** Put the caret at the end of a block. */
export async function caretToEndOf(block: Locator) {
  await block.scrollIntoViewIfNeeded();
  const b = await box(block);
  await block.click({ position: { x: b.width - 2, y: b.height - 4 } });
  // ProseMirror takes a click's caret from the next selectionchange; a key
  // pressed before that lands at the old caret.
  await expect
    .poll(() =>
      block.evaluate((el) => {
        type View = { state: { selection: { head: number } }; posAtDOM: (node: Node, offset: number) => number };
        const { view } = (el.closest(".ProseMirror") as HTMLElement & { editor: { view: View } }).editor;
        const sel = getSelection()!;
        return view.state.selection.head === view.posAtDOM(sel.focusNode!, sel.focusOffset);
      }),
    )
    .toBe(true);
}

/** Put the caret at the end of the note. */
export async function caretToEnd(page: Page, root: Locator = editor(page)) {
  await caretToEndOf(root.locator(":scope > *").last());
}

/** The caret's line, or the selection's box, in viewport coordinates. */
export async function selectionRect(page: Page): Promise<Rect> {
  return page.evaluate(() => {
    const range = window.getSelection()!.getRangeAt(0);
    const rects = range.getClientRects();
    // A caret in an empty block has no rects of its own: use the block.
    const node = range.startContainer;
    const r = range.collapsed
      ? (rects[0] ?? (node instanceof Element ? node : node.parentElement!).getBoundingClientRect())
      : range.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
}

export async function rectOf(locator: Locator): Promise<Rect> {
  const b = await box(locator);
  return { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width };
}

/**
 * Centre of the last word on the first visual line of a paragraph: the word
 * closest to the panel's right edge. One and two letter words are skipped: a
 * double click on those can select the space next to them instead.
 */
export async function lastWordOfFirstLine(paragraph: Locator): Promise<{ x: number; y: number }> {
  return paragraph.evaluate((p) => {
    const text = p.firstChild as Text;
    const range = document.createRange();
    let best: DOMRect | null = null;
    let firstTop: number | null = null;
    for (const match of text.data.matchAll(/\w{3,}/g)) {
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      const r = range.getBoundingClientRect();
      firstTop ??= r.top;
      if (Math.abs(r.top - firstTop) > 2) break;
      best = r;
    }
    return { x: best!.left + best!.width / 2, y: best!.top + best!.height / 2 };
  });
}

/** Centre of the first occurrence of `text` inside a block. */
export async function pointOfText(block: Locator, text: string): Promise<{ x: number; y: number }> {
  return block.evaluate((el, needle) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    throw new Error(`"${needle}" is not in the block`);
  }, text);
}

// ── popups ──────────────────────────────────────────────────────────────────

export const slashMenu = (page: Page) => page.getByTestId("slash-menu");
export const wikiMenu = (page: Page) => page.getByTestId("wiki-link-menu");
export const linkPopover = (page: Page) => page.getByTestId("link-popover");
export const tableMenu = (page: Page) => page.getByTestId("table-bubble-menu");
export const notePicker = (page: Page) => page.getByTestId("note-picker-popover");
export const generatePanel = (page: Page) =>
  page.locator('body > div > [data-testid="rephrase-panel"]');
/** The formatting toolbar over a text selection. */
export const selectionToolbar = (page: Page) =>
  page.locator("[data-tippy-root]").filter({ has: page.getByRole("button", { name: "Insert link" }) });
/** The selection toolbar's bubble once it has turned into the AI rephrase panel. */
export const rephraseBubble = (page: Page) =>
  page.locator("[data-tippy-root]").filter({ has: page.getByTestId("rephrase-panel") });
/** The edit bubble for a caret inside a link, and the form it turns into. */
export const linkBubble = (page: Page) =>
  page.locator("[data-tippy-root]").filter({ has: page.getByTestId("link-edit-button") });
export const linkEditForm = (page: Page) =>
  page.locator("[data-tippy-root]").filter({ has: page.getByLabel("URL") });
/** The reader's own toolbar over a selection in the PDF. */
export const pdfSelectionToolbar = (page: Page) =>
  page.locator("div.fixed").filter({ has: page.getByRole("button", { name: "Highlight green" }) });

/** The AI call behind a rephrase or generate panel has come back with text. */
export async function expectAiOutput(aiPanel: Locator) {
  await expect(aiPanel).toContainText("Esc to dismiss", { timeout: 120_000 });
  expect(await aiPanel.innerText(), "the AI call failed").not.toContain("AI error");
}

const EVERY_POPUP = [
  '[data-testid="slash-menu"]',
  '[data-testid="wiki-link-menu"]',
  '[data-testid="link-popover"]',
  '[data-testid="table-bubble-menu"]',
  '[data-testid="note-picker-popover"]',
  '[data-testid="rephrase-panel"]',
  "[data-tippy-root]",
].join(", ");

const EDGE_TOLERANCE = 1;
const ANCHOR_GAP = 12;
const CLAMP_MARGIN = 8;
/** Inside the popup's rounded corners, which are not part of its hit area. */
const CORNER_INSET = 6;

async function settledRect(locator: Locator): Promise<Rect> {
  let rect = await rectOf(locator);
  await expect(async () => {
    await locator.page().waitForTimeout(120);
    const next = await rectOf(locator);
    const moved = JSON.stringify(next) !== JSON.stringify(rect);
    rect = next;
    expect(moved, "popup still moving").toBe(false);
  }).toPass();
  return rect;
}

/**
 * A popup is where a user expects it: one instance, fully on screen, on top
 * of everything at its centre and corners, and attached to its anchor (the
 * caret line, the selection, the table, the trigger).
 */
export async function expectPopupSane(popup: Locator, anchor: Rect, label: string) {
  const page = popup.page();
  await expect(popup, `${label}: exactly one instance`).toHaveCount(1);
  await expect(popup, `${label}: visible`).toBeVisible();
  const rect = await settledRect(popup);
  const viewport = page.viewportSize()!;
  const where = `${label} ${JSON.stringify(rect)} anchor ${JSON.stringify(anchor)} viewport ${JSON.stringify(viewport)}`;

  // 1. Fully inside the viewport.
  expect(rect.left, `inside the viewport, left: ${where}`).toBeGreaterThanOrEqual(-EDGE_TOLERANCE);
  expect(rect.top, `inside the viewport, top: ${where}`).toBeGreaterThanOrEqual(-EDGE_TOLERANCE);
  expect(rect.right, `inside the viewport, right: ${where}`).toBeLessThanOrEqual(viewport.width + EDGE_TOLERANCE);
  expect(rect.bottom, `inside the viewport, bottom: ${where}`).toBeLessThanOrEqual(viewport.height + EDGE_TOLERANCE);

  // 2. Nothing covers it: the centre and the four inset corners hit the popup.
  const covered = await popup.evaluate((el, inset) => {
    const r = el.getBoundingClientRect();
    const points = [
      ["centre", r.left + r.width / 2, r.top + r.height / 2],
      ["top left", r.left + inset, r.top + inset],
      ["top right", r.right - inset, r.top + inset],
      ["bottom left", r.left + inset, r.bottom - inset],
      ["bottom right", r.right - inset, r.bottom - inset],
    ] as const;
    return points
      .filter(([, x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !hit || !el.contains(hit);
      })
      .map(([name, x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return `${name}: ${hit ? `<${hit.tagName.toLowerCase()} class="${hit.className}">` : "nothing"}`;
      });
  }, CORNER_INSET);
  expect(covered, `on top at the centre and corners: ${where}`).toEqual([]);

  // 3. Attached to its anchor: directly below or above it, and over it sideways
  // unless it was pushed back from a viewport edge.
  const gap = rect.top >= anchor.bottom - EDGE_TOLERANCE ? rect.top - anchor.bottom : anchor.top - rect.bottom;
  expect(gap, `directly above or below the anchor: ${where}`).toBeGreaterThanOrEqual(-EDGE_TOLERANCE);
  expect(gap, `vertical gap to the anchor: ${where}`).toBeLessThanOrEqual(ANCHOR_GAP);
  const near = rect.left <= anchor.right + ANCHOR_GAP && rect.right >= anchor.left - ANCHOR_GAP;
  const clamped =
    rect.left <= CLAMP_MARGIN + EDGE_TOLERANCE ||
    rect.right >= viewport.width - CLAMP_MARGIN - EDGE_TOLERANCE;
  expect(near || clamped, `horizontally at the anchor: ${where}`).toBe(true);
}

/** Remember what `body` holds before any popup opens. */
export async function markBodyBaseline(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __e2eBody: Set<Element> }).__e2eBody = new Set(document.body.children);
  });
}

/**
 * After a dismissal nothing is left behind: no known popup anywhere, and no
 * visible element in `body` that was not there before.
 */
export async function expectNothingLeftBehind(page: Page) {
  await expect(page.locator(EVERY_POPUP)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const baseline = (window as unknown as { __e2eBody: Set<Element> }).__e2eBody;
        return [...document.body.children]
          .filter((el) => !baseline.has(el))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => el.outerHTML.slice(0, 160));
      }),
    )
    .toEqual([]);
}

/** Nothing scrolls sideways: not the panel body, not the editor, not the page. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="reader-notes-body"]')!;
    const targets: [string, Element][] = [
      ["panel body", body],
      ["editor", body.querySelector(".ProseMirror")!],
      ["document", document.documentElement],
    ];
    return targets
      .filter(([, el]) => el.scrollWidth > el.clientWidth)
      .map(([name, el]) => `${name}: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
  });
  expect(overflow).toEqual([]);
}
