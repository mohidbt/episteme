import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/openrouter-key", () => ({
  getOrApiKey: vi.fn(),
  OpenRouterKeyMissing: class OpenRouterKeyMissing extends Error {
    constructor() {
      super("OpenRouterKeyMissing");
      this.name = "OpenRouterKeyMissing";
    }
  },
  OpenRouterTrialExhausted: class OpenRouterTrialExhausted extends Error {
    constructor() {
      super("OpenRouterTrialExhausted");
      this.name = "OpenRouterTrialExhausted";
    }
  },
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(() => ({ headers: { "X-Inhale-Sig": "stub" }, ts: "0" })),
}));

import { auth } from "@episteme/auth/server";
import { db } from "@/lib/db";
import { POST } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "11111111-1111-1111-1111-111111111111";
const buildReq = () =>
  new Request(
    `http://x/api/papers/${PAPER_ID}/auto-highlight/runs/${RUN_ID}/rebuild`,
    { method: "POST" },
  ) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID, runId: RUN_ID }) };

beforeEach(() => vi.resetAllMocks());

describe("POST /api/papers/[id]/auto-highlight/runs/[runId]/rebuild", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("400 on invalid runId", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    const badParams = {
      params: Promise.resolve({ id: PAPER_ID, runId: "not-a-uuid" }),
    };
    const res = await POST(buildReq(), badParams);
    expect(res.status).toBe(400);
  });

  it("404 when paper missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });
});
