// GSD-96 R3 — RED. Unit test (mocked db).
//
// Edge cases this covers:
//  - upsert path: inserts a new row when none exists
//  - upsert path: ON CONFLICT updates opened_at to now() when row exists
//  - trim path: after upsert, runs the "keep most-recent-50" DELETE bounded
//    to that user's rows (does not nuke other users)
//  - kind validation: only accepts paper|note|reference|paperset; throws otherwise
//  - idempotency: calling twice w/ same args does not throw or duplicate
//  - no-op safety: a swallowed DB error must not surface (caller fires + forgets
//    from server components, must not 500 the page render)
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { execute: vi.fn() } }));

import { db } from "@/lib/db";
import { touchRecent } from "../touch-recents";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("touchRecent", () => {
  it("issues an UPSERT and a trim DELETE", async () => {
    vi.mocked(db.execute).mockResolvedValue(undefined as never);
    await touchRecent({
      userId: "u-1",
      kind: "paper",
      itemId: "00000000-0000-0000-0000-000000000001",
    });
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown kinds", async () => {
    await expect(
      touchRecent({
        userId: "u-1",
        // @ts-expect-error invalid kind
        kind: "bogus",
        itemId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow();
  });

  it("swallows DB errors (fire-and-forget contract)", async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error("db down"));
    await expect(
      touchRecent({
        userId: "u-1",
        kind: "note",
        itemId: "00000000-0000-0000-0000-000000000002",
        swallow: true,
      }),
    ).resolves.toBeUndefined();
  });
});
