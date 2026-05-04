import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getRequiredUserId: vi.fn(async () => "u1") }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "paper-1", title: "", filename: "sample-paper.pdf" }],
        }),
      }),
    }),
  },
}));
import PaperReadPage from "../page";

describe("/papers/[id]/read", () => {
  it("renders the Reader for the requested paperId", async () => {
    const out = await PaperReadPage({ params: Promise.resolve({ id: "paper-1" }) });
    const snapshot = JSON.stringify(out);
    expect(snapshot).toContain("paper-1");
    expect(snapshot).toContain("/papers/paper-1/read");
    expect(snapshot).toContain("sample-paper");
  });
});
