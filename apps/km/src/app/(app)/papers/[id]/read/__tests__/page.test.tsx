import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getRequiredUserId: vi.fn(async () => "u1") }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "paper-1" }],
        }),
      }),
    }),
  },
}));

import PaperReadPage from "../page";

describe("/papers/[id]/read", () => {
  it("renders the Reader for the requested paperId", async () => {
    const out = await PaperReadPage({ params: Promise.resolve({ id: "paper-1" }) });
    expect(JSON.stringify(out)).toContain("paper-1");
  });
});
