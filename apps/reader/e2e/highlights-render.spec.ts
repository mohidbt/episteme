import { test, expect, Page } from "@playwright/test";
import { signUp, uniqueEmail, signUpAndLogin } from "./helpers/auth";
// Truth bboxes regenerated via `python e2e/fixtures/generate-truth.py` — rerun
// if the fixture PDF changes or pdfplumber is upgraded.
import {
  loadTruth,
  toPdfRect,
  seedAutoHighlightRun,
  getUserIdByEmail,
  type Truth,
} from "./helpers/seed-auto-highlight";
import * as fs from "fs";
import * as path from "path";

const PDF_PATH = path.join(__dirname, "fixtures/test_real_paper.pdf");
const CHEMO_PDF_PATH = path.join(__dirname, "fixtures/chemosensory.pdf");

async function uploadTestPdf(page: Page, filename: string): Promise<{ id: number }> {
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const response = await page.request.post("/api/documents/upload", {
    multipart: {
      file: {
        name: filename,
        mimeType: "application/pdf",
        buffer: pdfBuffer,
      },
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return { id: body.document.id as number };
}

async function uploadChemosensoryPdf(page: Page): Promise<{ id: number }> {
  const buf = fs.readFileSync(CHEMO_PDF_PATH);
  const res = await page.request.post("/api/documents/upload", {
    multipart: {
      file: { name: "chemosensory.pdf", mimeType: "application/pdf", buffer: buf },
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { id: body.document.id as number };
}

test("saving a highlight renders a colored overlay on the PDF", async ({ page }) => {
  await signUpAndLogin(page);
  const { id } = await uploadTestPdf(page, "test_real_paper.pdf");
  await page.goto(`/reader/${id}`);

  // Wait for the first page canvas to render
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

  // Wait until the text layer has rendered spans (react-pdf renders text
  // asynchronously after the canvas) AND the page element has its natural
  // size attributes populated — those are needed to compute rects for the
  // highlight overlay.
  await page.waitForFunction(
    () => {
      const pageEl = document.querySelector<HTMLElement>(
        '[data-page-number="1"][data-natural-width]'
      );
      if (!pageEl) return false;
      const w = Number(pageEl.getAttribute("data-natural-width"));
      if (!Number.isFinite(w) || w <= 0) return false;
      return document.querySelectorAll(".react-pdf__Page__textContent span").length > 0;
    },
    undefined,
    { timeout: 10_000 }
  );

  // Select a word on page 1 via DOM Range. Pick a span that is well inside
  // the viewport so the floating selection toolbar isn't clipped off-screen.
  await page.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll<HTMLElement>(".react-pdf__Page__textContent span")
    );
    const viewportH = window.innerHeight;
    const candidate =
      spans.find((s) => {
        const r = s.getBoundingClientRect();
        return r.top > 120 && r.bottom < viewportH - 40 && s.textContent?.trim();
      }) ?? spans[Math.floor(spans.length / 2)];
    if (!candidate) throw new Error("no text span");
    const r = document.createRange();
    r.selectNodeContents(candidate);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
  });

  // Wait for the floating selection toolbar to appear, then click yellow.
  await expect(page.getByTitle("yellow")).toBeVisible({ timeout: 5_000 });
  await page.getByTitle("yellow").click();

  // A highlight rectangle should appear on the canvas overlay.
  await expect(page.locator("[data-highlight-id]").first()).toBeVisible({ timeout: 10_000 });

  // Reload: highlight must persist and re-render from the lifted fetch.
  await page.reload();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-highlight-id]").first()).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Phase 2.1.2 — auto-highlight rect positioning gate (seeded via direct DB).
// Using the real Python pipeline would need OpenRouter + be slow/flaky, so we
// seed `ai_highlight_runs` + `user_highlights` rows from a pre-computed truth
// file (pdfplumber over `chemosensory.pdf`). The truth file is committed
// alongside the fixture.
// ---------------------------------------------------------------------------

async function waitForPageReady(page: Page, fixturePageNumber: number) {
  // react-pdf lazy-mounts pages via IntersectionObserver. Scroll to the
  // target page number first so it actually renders.
  await page.evaluate((n) => {
    const el = document.querySelector(`[data-page-number="${n}"]`);
    if (el) el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  }, fixturePageNumber);
  await page.waitForFunction(
    (n) => {
      const pageEl = document.querySelector<HTMLElement>(
        `[data-page-number="${n}"][data-natural-width]`
      );
      if (!pageEl) return false;
      const w = Number(pageEl.getAttribute("data-natural-width"));
      if (!Number.isFinite(w) || w <= 0) return false;
      return !!pageEl.querySelector(".react-pdf__Page__textContent span");
    },
    fixturePageNumber,
    { timeout: 15_000 }
  );
}

interface OverlayMeta {
  id: string;
  page: number;
  rectCenter: { x: number; y: number };
  rect: { left: number; top: number; right: number; bottom: number };
  pageBounds: { left: number; top: number; right: number; bottom: number };
  textTopHits: number;
}

async function collectOverlays(page: Page, fixturePageNumber: number): Promise<OverlayMeta[]> {
  return page.evaluate((n) => {
    const pageEl = document.querySelector<HTMLElement>(`[data-page-number="${n}"]`);
    if (!pageEl) return [];
    const pageBounds = pageEl.getBoundingClientRect();
    const spans = Array.from(
      pageEl.querySelectorAll<HTMLElement>(".react-pdf__Page__textContent span")
    ).map((s) => s.getBoundingClientRect());
    const overlays = Array.from(pageEl.querySelectorAll<HTMLElement>("[data-highlight-id]"));
    return overlays.map((el) => {
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      // count spans whose vertical band overlaps overlay top±2px
      const textTopHits = spans.filter(
        (s) => s.top <= cy && s.bottom >= cy && s.right > pageBounds.left
      ).length;
      return {
        id: el.getAttribute("data-highlight-id") ?? "",
        page: n,
        rectCenter: { x: cx, y: cy },
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        pageBounds: {
          left: pageBounds.left,
          top: pageBounds.top,
          right: pageBounds.right,
          bottom: pageBounds.bottom,
        },
        textTopHits,
      };
    });
  }, fixturePageNumber);
}

test.describe("auto-highlight rendering (Phase 2.1.2 gate)", () => {
  let truth: Truth;
  test.beforeAll(() => {
    truth = loadTruth();
  });

  // Validates the React overlay renderer end-to-end (seed → fetch → paint).
  // Python extraction math (pdfplumber glyph rects) is covered by
  // `services/agents/tests/test_auto_highlight_rects.py`.
  test("glyph accuracy, no blank-line rects, no overflow", async ({ page }) => {
    const email = uniqueEmail();
    const password = "Password123!";
    await signUp(page, email, password);
    const userId = await getUserIdByEmail(email);
    const { id: docId } = await uploadChemosensoryPdf(page);

    // Build seed highlights for "chemosensory" across fixture pages 1..4.
    const highlights = [] as Parameters<typeof seedAutoHighlightRun>[0]["highlights"];
    for (let fp = 1; fp <= 4; fp++) {
      const pageHeight = truth.pageHeight[fp - 1];
      const rectsOnPage = truth.chemosensory[String(fp)] ?? [];
      if (rectsOnPage.length === 0) continue;
      // One highlight row per occurrence (keeps mapping straightforward).
      for (const tr of rectsOnPage) {
        highlights.push({
          pageNumber: fp,
          textContent: "chemosensory",
          rects: [toPdfRect(tr, pageHeight, fp)],
        });
      }
    }
    expect(highlights.length).toBeGreaterThan(0);
    await seedAutoHighlightRun({
      documentId: docId,
      userId,
      instruction: "e2e: highlight 'chemosensory'",
      highlights,
    });

    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    for (const fp of [1, 2, 3, 4]) {
      const rectsOnPage = truth.chemosensory[String(fp)] ?? [];
      if (rectsOnPage.length === 0) continue;
      await waitForPageReady(page, fp);
      const overlays = await collectOverlays(page, fp);
      expect(overlays.length, `overlays on fixture page ${fp}`).toBe(rectsOnPage.length);

      // Each overlay center must fall within SOME target truth bbox on the page
      // (in CSS pixels, converted via page natural dims → displayed bounds).
      const pageHeight = truth.pageHeight[fp - 1];
      const pageWidth = truth.pageWidth[fp - 1];
      for (const ov of overlays) {
        const bounds = ov.pageBounds;
        const scaleX = (bounds.right - bounds.left) / pageWidth;
        const scaleY = (bounds.bottom - bounds.top) / pageHeight;
        const inside = rectsOnPage.some((tr) => {
          const l = bounds.left + tr.x0 * scaleX;
          const r = bounds.left + tr.x1 * scaleX;
          const t = bounds.top + tr.top * scaleY;
          const b = bounds.top + tr.bottom * scaleY;
          // 3pt tolerance scaled to pixels
          const pad = 3 * scaleX;
          return (
            ov.rectCenter.x >= l - pad &&
            ov.rectCenter.x <= r + pad &&
            ov.rectCenter.y >= t - pad &&
            ov.rectCenter.y <= b + pad
          );
        });
        expect(inside, `overlay ${ov.id} center inside truth bbox on page ${fp}`).toBe(true);

        // No overflow past page right edge.
        expect(ov.rect.right, `overlay ${ov.id} right <= page right`).toBeLessThanOrEqual(
          bounds.right + 0.5
        );

        // Overlay band overlaps a text-layer span (no blank-line rect).
        expect(ov.textTopHits, `overlay ${ov.id} overlaps text layer`).toBeGreaterThan(0);
      }
    }
  });

  test("sentence scope — single rect, bounded height", async ({ page }) => {
    const email = uniqueEmail();
    const password = "Password123!";
    await signUp(page, email, password);
    const userId = await getUserIdByEmail(email);
    const { id: docId } = await uploadChemosensoryPdf(page);

    // Pick the first occurrence on the first fixture page that has one.
    let fp = 0;
    for (let i = 1; i <= 4; i++) {
      if ((truth.sentence[String(i)] ?? []).length > 0) {
        fp = i;
        break;
      }
    }
    expect(fp, "fixture has at least one sentence-phrase occurrence").toBeGreaterThan(0);
    const tr = truth.sentence[String(fp)][0];
    const pageHeight = truth.pageHeight[fp - 1];
    await seedAutoHighlightRun({
      documentId: docId,
      userId,
      instruction: `e2e: sentence ${truth.sentencePhrase}`,
      highlights: [
        {
          pageNumber: fp,
          textContent: truth.sentencePhrase,
          rects: [toPdfRect(tr, pageHeight, fp)],
        },
      ],
    });

    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await waitForPageReady(page, fp);
    const overlays = await collectOverlays(page, fp);
    expect(overlays.length).toBe(1);
    const ov = overlays[0];
    const lineHeight = tr.bottom - tr.top;
    const pageScaleY = (ov.pageBounds.bottom - ov.pageBounds.top) / pageHeight;
    const overlayHeightPt = (ov.rect.bottom - ov.rect.top) / pageScaleY;
    expect(overlayHeightPt).toBeLessThanOrEqual(lineHeight * 2);
  });

  test("rebuild button — legacy sliver run wires UI → API", async ({ page }) => {
    const email = uniqueEmail();
    const password = "Password123!";
    await signUp(page, email, password);
    const userId = await getUserIdByEmail(email);
    const { id: docId } = await uploadChemosensoryPdf(page);

    // Seed a run with one sliver rect (width<5, height<2) — isStaleRect → true.
    const runId = await seedAutoHighlightRun({
      documentId: docId,
      userId,
      instruction: "e2e: legacy sliver",
      highlights: [
        {
          pageNumber: 1,
          textContent: "chemosensory",
          rects: [{ page: 1, x0: 100, y0: 400, x1: 101, y1: 401 }],
        },
      ],
    });

    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Rebuild button only renders when `hasStaleRects === true`. Confirm the
    // API surfaces that flag correctly for the seeded sliver.
    const runsRes = await page.request.get(
      `/api/documents/${docId}/auto-highlight/runs`
    );
    const runsBody = await runsRes.json();
    const seededRun = runsBody.runs.find((r: { id: string }) => r.id === runId);
    expect(seededRun?.hasStaleRects).toBe(true);

    // Open sidebar if collapsed — toolbar has a Highlights toggle.
    const rebuildBtn = page.locator(`[data-testid="ai-run-rebuild-${runId}"]`);
    if (!(await rebuildBtn.isVisible().catch(() => false))) {
      const toggle = page.getByRole("button", { name: /highlights/i }).first();
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
    }
    await expect(rebuildBtn).toBeVisible({ timeout: 10_000 });

    // Clicking the button should POST to the rebuild endpoint. Intercept the
    // request to confirm the UI → API wiring only. Full rebuild-loop gating
    // (sliver rect in → clean rect out of the Python handler) lives in
    // `services/agents/tests/test_auto_highlight_rebuild.py`.
    const rebuildRequest = page.waitForRequest(
      (req) =>
        req.url().includes(`/auto-highlight/runs/${runId}/rebuild`) &&
        req.method() === "POST",
      { timeout: 5_000 }
    );
    await rebuildBtn.click();
    await rebuildRequest;
  });
});
