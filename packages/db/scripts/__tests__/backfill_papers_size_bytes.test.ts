import { describe, it, expect, vi } from "vitest";
import { runBackfill } from "../backfill_papers_size_bytes";

type Row = { id: string; storage_url: string | null; size_bytes: number };

function makeDeps(initial: Row[]) {
  const rows = initial.map((r) => ({ ...r }));
  // selectCandidates returns rows where size_bytes = 0 AND storage_url IS NOT NULL
  const selectCandidates = vi.fn(async () =>
    rows
      .filter((r) => r.size_bytes === 0 && r.storage_url != null)
      .map((r) => ({ id: r.id, storage_url: r.storage_url as string })),
  );
  const updateSize = vi.fn(async (id: string, size: number) => {
    const row = rows.find((r) => r.id === id);
    if (row) row.size_bytes = size;
  });
  return { rows, selectCandidates, updateSize };
}

describe("backfill_papers_size_bytes", () => {
  it("skips rows with size_bytes > 0", async () => {
    const { rows, selectCandidates, updateSize } = makeDeps([
      { id: "a", storage_url: "a/source.pdf", size_bytes: 12345 },
      { id: "b", storage_url: "b/source.pdf", size_bytes: 0 },
    ]);
    const head = vi.fn(async () => ({ contentLength: 999 }));

    const result = await runBackfill({
      selectCandidates,
      updateSize,
      head,
      concurrency: 2,
      progressEvery: 1000,
    });

    // Only "b" reaches HEAD; "a" was filtered at the SELECT layer.
    expect(head).toHaveBeenCalledTimes(1);
    expect(head).toHaveBeenCalledWith("b/source.pdf");
    expect(updateSize).toHaveBeenCalledTimes(1);
    expect(updateSize).toHaveBeenCalledWith("b", 999);
    expect(rows.find((r) => r.id === "a")!.size_bytes).toBe(12345);
    expect(rows.find((r) => r.id === "b")!.size_bytes).toBe(999);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.scanned).toBe(1);
  });

  it("logs warn and continues on R2 404 / error", async () => {
    const { rows, selectCandidates, updateSize } = makeDeps([
      { id: "a", storage_url: "a/source.pdf", size_bytes: 0 },
      { id: "b", storage_url: "b/source.pdf", size_bytes: 0 },
    ]);
    const head = vi.fn(async (key: string) => {
      if (key === "a/source.pdf") {
        const err = new Error("NotFound") as Error & { $metadata?: { httpStatusCode: number } };
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return { contentLength: 4242 };
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runBackfill({
      selectCandidates,
      updateSize,
      head,
      concurrency: 2,
      progressEvery: 1000,
    });

    expect(updateSize).toHaveBeenCalledTimes(1);
    expect(updateSize).toHaveBeenCalledWith("b", 4242);
    expect(rows.find((r) => r.id === "a")!.size_bytes).toBe(0);
    expect(rows.find((r) => r.id === "b")!.size_bytes).toBe(4242);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls UPDATE with the Content-Length on successful HEAD", async () => {
    const { selectCandidates, updateSize } = makeDeps([
      { id: "x", storage_url: "x/source.pdf", size_bytes: 0 },
    ]);
    const head = vi.fn(async () => ({ contentLength: 8675309 }));

    await runBackfill({
      selectCandidates,
      updateSize,
      head,
      concurrency: 1,
      progressEvery: 1000,
    });

    expect(updateSize).toHaveBeenCalledExactlyOnceWith("x", 8675309);
  });

  it("is idempotent: a second run does nothing when all rows already backfilled", async () => {
    const deps = makeDeps([
      { id: "a", storage_url: "a/source.pdf", size_bytes: 0 },
    ]);
    const head = vi.fn(async () => ({ contentLength: 100 }));

    await runBackfill({
      selectCandidates: deps.selectCandidates,
      updateSize: deps.updateSize,
      head,
      concurrency: 1,
      progressEvery: 1000,
    });
    expect(deps.updateSize).toHaveBeenCalledTimes(1);

    // Second run: candidate query now returns nothing.
    const result2 = await runBackfill({
      selectCandidates: deps.selectCandidates,
      updateSize: deps.updateSize,
      head,
      concurrency: 1,
      progressEvery: 1000,
    });
    expect(head).toHaveBeenCalledTimes(1); // not called again
    expect(deps.updateSize).toHaveBeenCalledTimes(1); // not called again
    expect(result2.updated).toBe(0);
    expect(result2.skipped).toBe(0);
    expect(result2.scanned).toBe(0);
  });
});
