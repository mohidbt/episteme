import { test } from "@playwright/test";

test.describe("agent platform (1.3a substrate)", () => {
  test.skip("invoke + resume + state SSE round-trip — requires 1.3b agents", async () => {
    // Real E2E lands in 1.3b once skills + agents are wired.
  });
});
