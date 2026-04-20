import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

test.describe("PDF Reader", () => {
  let docId: number;

  test.beforeEach(async ({ page }) => {
    await signUpAndLogin(page);

    const pdfPath = path.join(__dirname, "fixtures/test.pdf");
    const pdfBuffer = fs.readFileSync(pdfPath);

    const response = await page.request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "test.pdf",
          mimeType: "application/pdf",
          buffer: pdfBuffer,
        },
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    docId = body.document.id;
  });

  // --- Navigation ---

  test("navigates to reader page for an uploaded document", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page).toHaveURL(new RegExp(`/reader/${docId}`));
  });

  test("visiting a nonexistent document ID returns 404", async ({ page }) => {
    // User is already authenticated from beforeEach
    const res = await page.request.get(`/api/documents/99999`);
    expect(res.status()).toBe(404);
  });

  test("Back button navigates to library", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/library/);
  });

  // --- PDF Rendering ---

  test("PDF renders a canvas element", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
  });

  test("PDF text content is selectable", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    const textLayer = page.locator(".react-pdf__Page__textContent");
    await expect(textLayer).toBeVisible();
    await expect(textLayer).toContainText("Test PDF Document");
  });

  test("reader loads within acceptable time", async ({ page }) => {
    const start = Date.now();
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  // --- Toolbar & Page Navigation ---

  test("toolbar is visible with page count and zoom controls", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

    const pageDisplay = page.locator("header").getByText(/\d+\s*\/\s*(\d+|—)/);
    await expect(pageDisplay).toBeVisible();
    await expect(page.locator("header").getByRole("button", { name: "+" })).toBeVisible();
    await expect(page.locator("header").getByRole("button", { name: "-" })).toBeVisible();
    await expect(page.locator("header").getByText(/%/)).toBeVisible();
  });

  test("page navigation shows correct count with Prev/Next disabled for single page", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

    await expect(page.locator("header").getByText("1 / 1")).toBeVisible();
    await expect(page.locator("header").getByRole("button", { name: "Prev" })).toBeDisabled();
    await expect(page.locator("header").getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  });

  // --- Zoom ---

  test("zoom in button increases the zoom percentage", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

    const zoomLabel = page.locator("header").getByText(/%/);
    const initialZoom = parseInt(await zoomLabel.innerText(), 10);
    await page.locator("header").getByRole("button", { name: "+" }).click();
    const updatedZoom = parseInt(await zoomLabel.innerText(), 10);
    expect(updatedZoom).toBeGreaterThan(initialZoom);
  });

  test("zoom out button decreases the zoom percentage", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

    const zoomLabel = page.locator("header").getByText(/%/);
    const initialZoom = parseInt(await zoomLabel.innerText(), 10);
    await page.locator("header").getByRole("button", { name: "-" }).click();
    const updatedZoom = parseInt(await zoomLabel.innerText(), 10);
    expect(updatedZoom).toBeLessThan(initialZoom);
  });

  test("Fit button resets zoom to 100%", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

    // Zoom in first
    await page.locator("header").getByRole("button", { name: "+" }).click();
    const zoomLabel = page.locator("header").getByText(/%/);
    expect(parseInt(await zoomLabel.innerText(), 10)).toBeGreaterThan(100);

    // Click Fit
    await page.getByRole("button", { name: "Fit" }).click();
    expect(parseInt(await zoomLabel.innerText(), 10)).toBe(100);
  });

  // --- Highlights Sidebar ---

  test("Highlights sidebar opens with empty state", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Highlights" }).click();
    await expect(page.getByRole("heading", { name: "Highlights" })).toBeVisible();
    await expect(page.getByText(/No highlights yet/)).toBeVisible();
  });

  // --- Chat Panel ---

  test("Chat panel opens with AI Assistant heading", async ({ page }) => {
    await page.goto(`/reader/${docId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Chat" }).click();
    await expect(page.getByText("AI Assistant")).toBeVisible();
    await expect(page.getByPlaceholder(/Ask about this paper/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

test.describe("PDF Reader - real paper benchmark", () => {
  let realDocId: number;

  test.beforeEach(async ({ page }) => {
    await signUpAndLogin(page);

    const pdfPath = path.join(__dirname, "fixtures/test_real_paper.pdf");
    const pdfBuffer = fs.readFileSync(pdfPath);

    const response = await page.request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "test_real_paper.pdf",
          mimeType: "application/pdf",
          buffer: pdfBuffer,
        },
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    realDocId = body.document.id;
  });

  test("real paper renders multiple pages", async ({ page }) => {
    await page.goto(`/reader/${realDocId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Page counter should show a total > 1
    const pageDisplay = page.locator("header").getByText(/\d+\s*\/\s*\d+/);
    await expect(pageDisplay).toBeVisible();
    const text = await pageDisplay.innerText();
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    expect(match).not.toBeNull();
    const total = Number(match![2]);
    expect(total).toBeGreaterThan(1);
  });

  test("Next button advances page counter and scrolls on real paper", async ({ page }) => {
    await page.goto(`/reader/${realDocId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Wait until totalPages has loaded (counter no longer shows "—")
    const pageDisplay = page.locator("header").getByText(/\d+\s*\/\s*\d+/);
    await expect(pageDisplay).toBeVisible();
    const initialText = await pageDisplay.innerText();
    const initialMatch = initialText.match(/(\d+)\s*\/\s*(\d+)/);
    expect(initialMatch).not.toBeNull();
    expect(Number(initialMatch![1])).toBe(1);
    const total = Number(initialMatch![2]);
    expect(total).toBeGreaterThan(1);

    // Click Next
    await page.locator("header").getByRole("button", { name: "Next", exact: true }).click();

    // Counter should become "2 / N"
    await expect(page.locator("header").getByText(new RegExp(`2\\s*/\\s*${total}`))).toBeVisible();

    // And the reader container should have scrolled past the top
    const scrollTop = await page.evaluate(() => {
      const el = document.querySelector(".flex-1.overflow-auto.bg-muted\\/30") as HTMLElement | null;
      return el?.scrollTop ?? 0;
    });
    expect(scrollTop).toBeGreaterThan(0);
  });

  test("real paper loads within acceptable time", async ({ page }) => {
    const start = Date.now();
    await page.goto(`/reader/${realDocId}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});
