import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import path from "path";
import fs from "fs";

const PDF_PATH = path.join(__dirname, "fixtures/test.pdf");

async function uploadDocument(page: import("@playwright/test").Page): Promise<number> {
  const pdfBytes = fs.readFileSync(PDF_PATH);
  const res = await page.request.post("/api/documents/upload", {
    multipart: {
      file: { name: "test.pdf", mimeType: "application/pdf", buffer: pdfBytes },
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.document.id as number;
}

test.describe("Auto-highlight runs API", () => {
  test("unauthenticated GET returns 401", async ({ page }) => {
    const res = await page.request.get("/api/documents/1/auto-highlight/runs");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated DELETE returns 401", async ({ page }) => {
    const res = await page.request.delete(
      "/api/documents/1/auto-highlight/runs/00000000-0000-0000-0000-000000000000"
    );
    expect(res.status()).toBe(401);
  });

  test("GET returns empty runs list for a doc with no runs", async ({ page }) => {
    await signUpAndLogin(page);
    const docId = await uploadDocument(page);
    const res = await page.request.get(`/api/documents/${docId}/auto-highlight/runs`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.runs).toEqual([]);
  });

  test("GET 404 for document not owned by user", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await signUpAndLogin(pageA);
    const docId = await uploadDocument(pageA);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signUpAndLogin(pageB);
    const res = await pageB.request.get(`/api/documents/${docId}/auto-highlight/runs`);
    expect(res.status()).toBe(404);

    await ctxA.close();
    await ctxB.close();
  });

  test("DELETE returns 404 for nonexistent run", async ({ page }) => {
    await signUpAndLogin(page);
    const docId = await uploadDocument(page);
    const res = await page.request.delete(
      `/api/documents/${docId}/auto-highlight/runs/00000000-0000-0000-0000-000000000000`
    );
    expect(res.status()).toBe(404);
  });
});
