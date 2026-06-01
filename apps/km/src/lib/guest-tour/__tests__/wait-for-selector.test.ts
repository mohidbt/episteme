// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { waitForSelector } from "../wait-for-selector";

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("waitForSelector", () => {
  it("resolves immediately when element already exists", async () => {
    const el = document.createElement("div");
    el.id = "already-here";
    document.body.appendChild(el);
    const found = await waitForSelector("#already-here", 1000);
    expect(found).toBe(el);
  });

  it("resolves when element appears later", async () => {
    const promise = waitForSelector("#late", 1500);
    setTimeout(() => {
      const el = document.createElement("div");
      el.id = "late";
      document.body.appendChild(el);
    }, 50);
    const found = await promise;
    expect(found).not.toBeNull();
    expect((found as HTMLElement).id).toBe("late");
  });

  it("resolves null when selector never appears within timeout", async () => {
    const found = await waitForSelector("#never", 100);
    expect(found).toBeNull();
  });
});
