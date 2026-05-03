import { test, expect } from "@playwright/test";

// Phase 1.6b T6 — AI rewire gate.
// Asserts: reader-page AgentBall opens the ReaderSidePanel (not the global
// popover); panel renders KM <AgentTranscript>; SelectionToolbar "Explain"
// button invokes /api/agents/km/invoke with a thread_id + message that
// references the selected passage. The agent's main LLM is responsible for
// calling pdf_explain_passage from there.
//
// Runner caveat: as of 1.6b, apps/km does not yet wire @playwright/test
// (no devDependency, no playwright.config). This spec is a frozen contract;
// it lives alongside the ported reader-*.spec.ts and runs once the runner is
// adopted in a later phase. The 1.6b acceptance gate is the manual Chrome
// DevTools MCP checklist below.

test.describe("Phase 1.6b — reader AI rewire", () => {
  test("reader toolbar Agent toggle opens KM transcript dock panel", async ({ page }) => {
    const paperId = process.env.TEST_PAPER_ID;
    test.skip(!paperId, "TEST_PAPER_ID env var required");
    await page.goto(`/papers/${paperId}/read`);
    await page.getByTestId("reader-toolbar-agent").click();
    await expect(page.getByTestId("panel-sidebar-agent")).toBeVisible();
    await expect(page.getByTestId("panel-sidebar-agent")).toContainText(/./);
  });

  test("global AgentBall is hidden on reader route", async ({ page }) => {
    const paperId = process.env.TEST_PAPER_ID;
    test.skip(!paperId, "TEST_PAPER_ID env var required");
    await page.goto(`/papers/${paperId}/read`);
    // Global ball uses data-testid="agent-ball". Reader exposes its agent
    // surface via the in-toolbar toggle (data-testid="reader-toolbar-agent")
    // so the floating global ball must not appear here.
    await expect(page.getByTestId("agent-ball")).toHaveCount(0);
    await expect(page.getByTestId("reader-toolbar-agent")).toBeVisible();
  });

  test("explain passage routes through pdf_explain_passage tool", async ({
    page,
  }) => {
    const paperId = process.env.TEST_PAPER_ID;
    test.skip(!paperId, "TEST_PAPER_ID env var required");
    await page.goto(`/papers/${paperId}/read`);

    // Capture the invoke request fired when the user clicks Explain.
    const invokePromise = page.waitForRequest(
      (req) =>
        req.url().includes("/api/agents/km/invoke") && req.method() === "POST",
    );

    // Selection + toolbar trigger is project-specific. Use the existing
    // helper if/when reader e2e helpers grow one. Until then, simulate via
    // evaluate_script: dispatch a selection over a known span and click the
    // toolbar button that exposes data-action="explain".
    await page.getByRole("button", { name: /explain/i }).click();

    const req = await invokePromise;
    const body = JSON.parse(req.postData() ?? "{}") as {
      thread_id?: string;
      message?: string;
    };
    expect(body.thread_id).toBeTruthy();
    expect(body.message ?? "").toMatch(/Explain this passage/);

    await expect(page.getByTestId("panel-sidebar-agent")).toBeVisible();
  });
});
