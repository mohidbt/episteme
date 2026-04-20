import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const pdfFixture = path.join(__dirname, "fixtures", "test.pdf");

test.describe("API route security — unauthenticated 401s", () => {
  test("GET /api/documents/999 returns 401", async ({ page }) => {
    const res = await page.request.get("/api/documents/999");
    expect(res.status()).toBe(401);
  });

  test("GET /api/documents/999/file returns 401", async ({ page }) => {
    const res = await page.request.get("/api/documents/999/file");
    expect(res.status()).toBe(401);
  });

  test("GET /api/documents/999/highlights returns 401", async ({ page }) => {
    const res = await page.request.get("/api/documents/999/highlights");
    expect(res.status()).toBe(401);
  });

  test("GET /api/documents/999/outline returns 401", async ({ page }) => {
    const res = await page.request.get("/api/documents/999/outline");
    expect(res.status()).toBe(401);
  });

  test("GET /api/settings/api-keys returns 401", async ({ page }) => {
    const res = await page.request.get("/api/settings/api-keys");
    expect(res.status()).toBe(401);
  });

  test("POST /api/documents/upload returns 401", async ({ page }) => {
    const res = await page.request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "test.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4"),
        },
      },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Cross-user isolation", () => {
  test("User B cannot access User A's document", async ({ browser }) => {
    const pdf = fs.readFileSync(pdfFixture);

    // User A: sign up, upload a doc
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await signUpAndLogin(pageA);

    const uploadRes = await pageA.request.post("/api/documents/upload", {
      multipart: {
        file: { name: "test.pdf", mimeType: "application/pdf", buffer: pdf },
      },
    });
    expect(uploadRes.status()).toBe(201);
    const { document: doc } = await uploadRes.json();
    const docId = doc.id;

    // Verify A can access it
    const resA = await pageA.request.get(`/api/documents/${docId}`);
    expect(resA.status()).toBe(200);

    // User B: fresh context, sign up
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signUpAndLogin(pageB);

    // User B tries to access User A's document — should 404 (not found for this user)
    const resB = await pageB.request.get(`/api/documents/${docId}`);
    expect(resB.status()).toBe(404);

    const resFile = await pageB.request.get(`/api/documents/${docId}/file`);
    expect(resFile.status()).toBe(404);

    await ctxA.close();
    await ctxB.close();
  });
});
