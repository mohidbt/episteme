import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers/auth";
import path from "path";
import fs from "fs";

const PDF_PATH = path.join(__dirname, "fixtures/test.pdf");

// Upload a PDF via the API and return its document ID.
async function uploadDocument(page: import("@playwright/test").Page): Promise<number> {
  const pdfBytes = fs.readFileSync(PDF_PATH);

  const response = await page.request.post("/api/documents/upload", {
    multipart: {
      file: {
        name: "test.pdf",
        mimeType: "application/pdf",
        buffer: pdfBytes,
      },
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(typeof body.document.id).toBe("number");
  return body.document.id as number;
}

test.describe("Highlights API", () => {
  test("create, list, and delete a highlight", async ({ page }) => {
    await signUpAndLogin(page);
    const docId = await uploadDocument(page);
    const base = `/api/documents/${docId}/highlights`;

    // POST — create highlight
    const createRes = await page.request.post(base, {
      data: {
        pageNumber: 1,
        textContent: "Hello world",
        startOffset: 0,
        endOffset: 11,
        color: "yellow",
        note: "My first highlight",
      },
    });
    expect(createRes.status()).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.highlight).toBeDefined();
    const highlightId: number = createBody.highlight.id;
    expect(typeof highlightId).toBe("number");
    expect(createBody.highlight.textContent).toBe("Hello world");
    expect(createBody.highlight.color).toBe("yellow");
    expect(createBody.highlight.pageNumber).toBe(1);

    // GET — list should contain the new highlight
    const listRes = await page.request.get(base);
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    expect(Array.isArray(listBody.highlights)).toBe(true);
    const found = listBody.highlights.find((h: { id: number }) => h.id === highlightId);
    expect(found).toBeDefined();
    expect(found.textContent).toBe("Hello world");

    // DELETE — remove the highlight
    const deleteRes = await page.request.delete(`${base}?highlightId=${highlightId}`);
    expect(deleteRes.status()).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toBe(true);

    // GET — highlight should no longer appear
    const listAfterRes = await page.request.get(base);
    expect(listAfterRes.status()).toBe(200);
    const listAfterBody = await listAfterRes.json();
    const stillPresent = listAfterBody.highlights.find((h: { id: number }) => h.id === highlightId);
    expect(stillPresent).toBeUndefined();
  });

  test("defaults color to yellow when an invalid color is supplied", async ({ page }) => {
    await signUpAndLogin(page);
    const docId = await uploadDocument(page);

    const res = await page.request.post(`/api/documents/${docId}/highlights`, {
      data: {
        pageNumber: 1,
        textContent: "Color fallback text",
        startOffset: 0,
        endOffset: 19,
        color: "purple", // not in the valid list
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.highlight.color).toBe("yellow");
  });

  test("returns 422 when required fields are missing", async ({ page }) => {
    await signUpAndLogin(page);
    const docId = await uploadDocument(page);

    // Missing textContent
    const res = await page.request.post(`/api/documents/${docId}/highlights`, {
      data: {
        pageNumber: 1,
        startOffset: 0,
        endOffset: 5,
      },
    });
    expect(res.status()).toBe(422);
  });

  test("returns 401 when not authenticated", async ({ page }) => {
    // Do NOT sign in — attempt request cold
    const res = await page.request.get("/api/documents/1/highlights");
    expect(res.status()).toBe(401);
  });

  test("POST creates highlight with rects; GET returns them", async ({ page }) => {
    await signUpAndLogin(page);
    const docId = await uploadDocument(page);
    const base = `/api/documents/${docId}/highlights`;

    const createRes = await page.request.post(base, {
      data: {
        pageNumber: 1,
        textContent: "rect-test",
        startOffset: 0,
        endOffset: 9,
        color: "yellow",
        rects: [{ page: 1, x0: 10, y0: 100, x1: 50, y1: 110 }],
      },
    });
    expect(createRes.status()).toBe(201);

    const listRes = await page.request.get(base);
    const body = await listRes.json();
    const latest = body.highlights.find((h: { textContent: string }) => h.textContent === "rect-test");
    expect(latest).toBeDefined();
    expect(latest.rects).toEqual([{ page: 1, x0: 10, y0: 100, x1: 50, y1: 110 }]);
  });
});

test.describe("Highlights and Comments isolation", () => {
  test("a second user cannot see highlights created by the first user", async ({
    browser,
  }) => {
    // User A
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await signUpAndLogin(pageA);
    const docId = await uploadDocument(pageA);

    const hlRes = await pageA.request.post(`/api/documents/${docId}/highlights`, {
      data: {
        pageNumber: 1,
        textContent: "User A exclusive",
        startOffset: 0,
        endOffset: 16,
        color: "blue",
      },
    });
    expect(hlRes.status()).toBe(201);

    // User B — separate session
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signUpAndLogin(pageB);

    // User B requests User A's document highlights — document is owned by A so
    // the highlight query will return only B's own highlights (none) because the
    // DB filters by userId. The endpoint itself returns 200 with an empty list
    // rather than 404 because the route only filters highlights by userId, not
    // the document's owner. Either outcome is acceptable; what matters is that
    // User A's highlight is NOT present.
    const listRes = await pageB.request.get(`/api/documents/${docId}/highlights`);
    // Could be 200 (empty) or 404 depending on implementation — both are fine.
    if (listRes.status() === 200) {
      const body = await listRes.json();
      const leaked = (body.highlights ?? []).find(
        (h: { textContent: string }) => h.textContent === "User A exclusive"
      );
      expect(leaked).toBeUndefined();
    } else {
      expect([401, 403, 404]).toContain(listRes.status());
    }

    await ctxA.close();
    await ctxB.close();
  });
});
