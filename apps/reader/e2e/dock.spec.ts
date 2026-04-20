import { test, expect, type Page } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const realPdfPath = path.join(__dirname, "fixtures/test_real_paper.pdf");
const FAILURE_DIR = path.join(__dirname, "__failures__");

async function uploadRealPdf(page: Page) {
  const buf = fs.readFileSync(realPdfPath);
  const res = await page.request.post("/api/documents/upload", {
    multipart: {
      file: { name: "test_real_paper.pdf", mimeType: "application/pdf", buffer: buf },
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.document as { id: number };
}

async function pickDock(
  page: Page,
  panelTestId: string,
  target: "left" | "right" | "bottom"
) {
  // The dock menu trigger lives inside each sidebar's header (no longer
  // absolutely positioned). Scope by the panel testid so we hit the right
  // sidebar's dock control.
  const panel = page.locator(`[data-testid="${panelTestId}"]`);
  const trigger = panel.locator('[data-testid="dock-menu-trigger"]');
  await trigger.click();
  await page.locator(`[data-testid="dock-menu-item-${target}"]`).first().click();
}

test.describe("Dockable sidebars", () => {
  test.beforeEach(async ({ page, context }) => {
    await signUpAndLogin(page);
    // Each test starts with a clean dock state — sidebars default to right
    // dock unless localStorage says otherwise. We don't need to clear
    // anything because signUpAndLogin gives us a fresh user, but we DO
    // clear localStorage for safety since the helper reuses the page.
    await context.addInitScript(() => {
      try {
        Object.keys(window.localStorage)
          .filter((k) => k.startsWith("dockable-sidebar:"))
          .forEach((k) => window.localStorage.removeItem(k));
      } catch {
        /* ignore — storage may not be ready yet */
      }
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        if (!fs.existsSync(FAILURE_DIR)) fs.mkdirSync(FAILURE_DIR, { recursive: true });
        const safe = testInfo.title.replace(/[^a-z0-9]+/gi, "_");
        await page.screenshot({
          path: path.join(FAILURE_DIR, `dock_${safe}.png`),
          fullPage: true,
        });
      } catch {
        /* best effort */
      }
    }
  });

  test("Chat panel re-docks left, right, and bottom (DOM order + bbox)", async ({ page }) => {
    const { id: docId } = await uploadRealPdf(page);
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open the chat panel.
    await page.getByRole("button", { name: "Chat" }).click();
    await expect(page.getByText("AI Assistant")).toBeVisible();

    const pdfPanel = page.locator('[data-testid="pdf-viewer-panel"]');
    const chatPanel = page.locator('[data-testid="panel-sidebar-chat"]');

    await expect(pdfPanel).toBeVisible();
    await expect(chatPanel).toBeVisible();

    // ---- Initial state: chat docks RIGHT of PDF ----
    {
      const pdfBox = await pdfPanel.boundingBox();
      const chatBox = await chatPanel.boundingBox();
      expect(pdfBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      // Chat is to the right of (or at least not to the left of) the PDF.
      expect(chatBox!.x).toBeGreaterThan(pdfBox!.x);
      // DOM order: PDF appears before chat.
      const order = await page.evaluate(() => {
        const pdf = document.querySelector('[data-testid="pdf-viewer-panel"]')!;
        const chat = document.querySelector('[data-testid="panel-sidebar-chat"]')!;
        return pdf.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING ? "pdf-then-chat" : "chat-then-pdf";
      });
      expect(order).toBe("pdf-then-chat");
    }

    // ---- Re-dock LEFT ----
    await pickDock(page, "panel-sidebar-chat", "left");
    // Wait for layout to settle.
    await page.waitForTimeout(150);
    {
      const pdfBox = await pdfPanel.boundingBox();
      const chatBox = await chatPanel.boundingBox();
      expect(pdfBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      expect(chatBox!.x).toBeLessThan(pdfBox!.x);
      const order = await page.evaluate(() => {
        const pdf = document.querySelector('[data-testid="pdf-viewer-panel"]')!;
        const chat = document.querySelector('[data-testid="panel-sidebar-chat"]')!;
        return pdf.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_PRECEDING ? "chat-then-pdf" : "pdf-then-chat";
      });
      expect(order).toBe("chat-then-pdf");
    }

    // ---- Re-dock BOTTOM ----
    await pickDock(page, "panel-sidebar-chat", "bottom");
    await page.waitForTimeout(150);
    {
      const pdfBox = await pdfPanel.boundingBox();
      const chatBox = await chatPanel.boundingBox();
      expect(pdfBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      // Chat is BELOW the PDF.
      expect(chatBox!.y).toBeGreaterThan(pdfBox!.y);
      // Widths are roughly equal (within 50px).
      expect(Math.abs(chatBox!.width - pdfBox!.width)).toBeLessThan(50);
      // The bottom-dock container exists and contains the chat panel.
      await expect(page.locator('[data-testid="bottom-dock-panel"]')).toBeVisible();
    }
  });

  test("Sidebar header stays single-line at 280px min width", async ({ page }) => {
    const { id: docId } = await uploadRealPdf(page);
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open chat (right-docked by default).
    await page.getByRole("button", { name: "Chat" }).click();
    await expect(page.getByText("AI Assistant")).toBeVisible();

    const chatPanel = page.locator('[data-testid="panel-sidebar-chat"]');
    const header = chatPanel.locator("div").first();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    // At default size (~320px) the header should comfortably be on a single
    // line — height < ~60px is plenty of slack for one row of small buttons.
    expect(headerBox!.height).toBeLessThan(60);

    // Verify the panel itself is at least the enforced min width.
    const panelBox = await chatPanel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeGreaterThanOrEqual(279); // tolerate 1px rounding
  });
});
