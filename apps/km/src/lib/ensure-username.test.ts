// GSD-46 — defensive backfill that claims a derived username when the row
// has none. Unit-tests cover the slug derivation + collision-retry contract
// without touching a real DB.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted db mock — express the chainable shape Drizzle uses. We only need
// the calls the helper makes: select(...).from(...).where(...).limit(...),
// update(...).set(...).where(...).returning(...).
const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
};
const updateChain = {
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};
const dbMock = {
  select: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

let ensureUsername: typeof import("./ensure-username").ensureUsername;

beforeEach(async () => {
  vi.resetAllMocks();
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.limit.mockReturnValue(selectChain);
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockReturnValue(updateChain);
  updateChain.returning.mockReturnValue(updateChain);
  dbMock.select.mockReturnValue(selectChain);
  dbMock.update.mockReturnValue(updateChain);
  ({ ensureUsername } = await import("./ensure-username"));
});

afterEach(() => {
  vi.resetModules();
});

function mockUserRow(row: {
  username: string | null;
  name?: string | null;
  email?: string | null;
}) {
  selectChain.limit.mockResolvedValueOnce([row]);
}

describe("ensureUsername", () => {
  it("returns the existing username without touching update", async () => {
    mockUserRow({ username: "mohid", name: "Mohid", email: "m@x.io" });
    const got = await ensureUsername("u1", { name: null, email: null });
    expect(got).toBe("mohid");
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("derives username from name slug when username is null and claims it", async () => {
    mockUserRow({ username: null, name: "Test User", email: "test@mohid.de" });
    updateChain.returning.mockResolvedValueOnce([{ username: "test-user" }]);

    const got = await ensureUsername("u1", { name: null, email: null });
    expect(got).toBe("test-user");
    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({ username: "test-user" });
  });

  it("falls back to email local-part if name is empty", async () => {
    mockUserRow({ username: null, name: null, email: "alice@x.io" });
    updateChain.returning.mockResolvedValueOnce([{ username: "alice" }]);

    const got = await ensureUsername("u1", { name: null, email: null });
    expect(got).toBe("alice");
  });

  it("falls back to userId tail if name + email are unusable", async () => {
    mockUserRow({ username: null, name: " ", email: null });
    updateChain.returning.mockResolvedValueOnce([
      { username: "user-cafebabe" },
    ]);

    const got = await ensureUsername("u_CAFEBABE", { name: null, email: null });
    expect(got).toBe("user-cafebabe");
  });

  it("retries with -1, -2 suffix on UNIQUE collision", async () => {
    mockUserRow({ username: null, name: "Tom", email: null });
    // First attempt: 0 rows updated. Refetch shows still NULL → next suffix.
    updateChain.returning
      .mockResolvedValueOnce([]) // base "tom" lost the NULL-only update
      .mockResolvedValueOnce([{ username: "tom-1" }]);
    // Refetch after the failed first claim: still null.
    selectChain.limit.mockResolvedValueOnce([{ username: null }]);

    const got = await ensureUsername("u1", { name: null, email: null });
    expect(got).toBe("tom-1");
    expect(updateChain.set).toHaveBeenNthCalledWith(1, { username: "tom" });
    expect(updateChain.set).toHaveBeenNthCalledWith(2, { username: "tom-1" });
  });

  it("returns the value a concurrent writer claimed, not the requested candidate", async () => {
    // Even though our UPDATE finds 0 rows, the refetch reveals another
    // request already persisted a different slug. Page must use that slug
    // instead of our stale candidate.
    mockUserRow({ username: null, name: "Tom", email: null });
    updateChain.returning.mockResolvedValueOnce([]);
    selectChain.limit.mockResolvedValueOnce([
      { username: "tom-claimed-by-other" },
    ]);

    const got = await ensureUsername("u1", { name: null, email: null });
    expect(got).toBe("tom-claimed-by-other");
  });

  it("treats a 23505 thrown error as collision and tries next suffix", async () => {
    mockUserRow({ username: null, name: "Tom", email: null });
    updateChain.returning.mockImplementationOnce(() => {
      const err = Object.assign(new Error("duplicate"), { code: "23505" });
      throw err;
    });
    updateChain.returning.mockResolvedValueOnce([{ username: "tom-1" }]);

    const got = await ensureUsername("u1", { name: null, email: null });
    expect(got).toBe("tom-1");
  });

  it("returns null if user row missing", async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const got = await ensureUsername("nope", { name: null, email: null });
    expect(got).toBeNull();
  });
});
