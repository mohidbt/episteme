// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock heavy/auth-dependent modules so the test can load standalone.
vi.mock("@/lib/db", () => {
  // Fluent chain: db.select().from().where().limit() / db.update().set().where()
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
    __selectChain: selectChain,
    __updateChain: updateChain,
  };
});

vi.mock("@episteme/markdown", () => ({
  mdToProseMirror: vi.fn(() => null),
}));

vi.mock("@episteme/notes-core", () => ({
  rebuildLinks: vi.fn(async () => {}),
  createRevisionIfNeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/ai/embed-on-save", () => ({
  embedOnSave: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/library-usage", () => ({
  LIBRARY_BYTES_LIMIT: 100 * 1024 * 1024,
  getLibraryUsageBytes: vi.fn(),
}));

import { db } from "@/lib/db";
import { getLibraryUsageBytes, LIBRARY_BYTES_LIMIT } from "@/lib/library-usage";
import { saveNoteMd, NoteOverLimitError } from "./save-note-md";

const selectChain = (db as unknown as { select: () => unknown }).select() as {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.mocked(getLibraryUsageBytes).mockReset();
  selectChain.limit.mockReset();
});

describe("saveNoteMd cap-on-edit (Codex B-fix)", () => {
  it("throws NoteOverLimitError when projected size exceeds LIBRARY_BYTES_LIMIT", async () => {
    selectChain.limit.mockResolvedValue([
      { libraryId: 1, sizeBytes: LIBRARY_BYTES_LIMIT - 1 },
    ]);
    vi.mocked(getLibraryUsageBytes).mockResolvedValue({
      papers: 0,
      notes: LIBRARY_BYTES_LIMIT - 1,
      assets: 0,
      total: LIBRARY_BYTES_LIMIT - 1,
    });

    // Two-byte body → projected = (LIMIT-1) - (LIMIT-1) + 2 = 2; wait that's
    // not right. Reread: projected = usage.total - old.sizeBytes + new.size
    //                              = (LIMIT-1) - (LIMIT-1) + 2 = 2 → OK.
    // We need a SECOND library row with extra usage so the cap triggers.
    // Adjust: total includes OTHER content in the library (e.g. assets) so
    // when old size is removed, the remainder is still near the limit.
    vi.mocked(getLibraryUsageBytes).mockResolvedValue({
      papers: 0,
      notes: LIBRARY_BYTES_LIMIT - 1,
      assets: LIBRARY_BYTES_LIMIT - 1, // unrealistic but exercises the math
      total: 2 * (LIBRARY_BYTES_LIMIT - 1),
    });
    // projected = 2*(LIMIT-1) - (LIMIT-1) + 2 = LIMIT + 1 → REJECT

    await expect(
      saveNoteMd("note-1", "xx", "user-1", "autosave"),
    ).rejects.toBeInstanceOf(NoteOverLimitError);
  });

  it("allows edit when projected size is exactly LIBRARY_BYTES_LIMIT", async () => {
    selectChain.limit.mockResolvedValue([
      { libraryId: 1, sizeBytes: 0 },
    ]);
    vi.mocked(getLibraryUsageBytes).mockResolvedValue({
      papers: 0,
      notes: 0,
      assets: LIBRARY_BYTES_LIMIT - 1,
      total: LIBRARY_BYTES_LIMIT - 1,
    });

    // Single-byte body → projected = (LIMIT-1) - 0 + 1 = LIMIT → allowed.
    await expect(
      saveNoteMd("note-1", "y", "user-1", "autosave"),
    ).resolves.toBeUndefined();
  });

  it("no existing row → skips cap check (insert path handles new rows)", async () => {
    selectChain.limit.mockResolvedValue([]);
    vi.mocked(getLibraryUsageBytes).mockResolvedValue({
      papers: 0,
      notes: 0,
      assets: 0,
      total: 0,
    });

    await expect(
      saveNoteMd("missing", "any", "user-1", "autosave"),
    ).resolves.toBeUndefined();
    expect(getLibraryUsageBytes).not.toHaveBeenCalled();
  });
});
