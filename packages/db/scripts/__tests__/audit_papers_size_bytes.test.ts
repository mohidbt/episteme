import { describe, it, expect, vi } from "vitest";
import { runAudit, type AuditRow } from "../audit_papers_size_bytes";

function singleBatchDeps(
  rows: AuditRow[],
  headFn: (key: string) => Promise<{ contentLength: number } | null>,
) {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    selectRows: async function* () {
      yield rows;
    },
    head: vi.fn(headFn),
    concurrency: 5,
    progressEvery: 1000,
  };
}

describe("audit_papers_size_bytes", () => {
  it("tallies match when DB size_bytes equals R2 Content-Length", async () => {
    const deps = singleBatchDeps(
      [{ id: "a", size_bytes: 12345, storage_url: "a/x.pdf" }],
      async () => ({ contentLength: 12345 }),
    );
    const result = await runAudit(deps);
    expect(result.total).toBe(1);
    expect(result.match).toBe(1);
    expect(result.mismatch).toBe(0);
    expect(result.examples).toEqual([]);
  });

  it("flags mismatch with delta in examples", async () => {
    const deps = singleBatchDeps(
      [{ id: "b", size_bytes: 100, storage_url: "b/x.pdf" }],
      async () => ({ contentLength: 150 }),
    );
    const result = await runAudit(deps);
    expect(result.mismatch).toBe(1);
    expect(result.examples).toEqual([
      { id: "b", recorded: 100, actual: 150, delta: 50 },
    ]);
  });

  it("counts missing R2 (HEAD 404 → null) separately", async () => {
    const deps = singleBatchDeps(
      [{ id: "c", size_bytes: 1, storage_url: "missing.pdf" }],
      async () => null,
    );
    const result = await runAudit(deps);
    expect(result.missingR2).toBe(1);
    expect(result.match).toBe(0);
    expect(result.mismatch).toBe(0);
  });

  it("counts errors and continues to next row", async () => {
    let n = 0;
    const deps = singleBatchDeps(
      [
        { id: "x", size_bytes: 1, storage_url: "x.pdf" },
        { id: "y", size_bytes: 2, storage_url: "y.pdf" },
      ],
      async () => {
        n++;
        if (n === 1) throw new Error("boom");
        return { contentLength: 2 };
      },
    );
    const result = await runAudit(deps);
    expect(result.error).toBe(1);
    expect(result.match).toBe(1);
    expect(result.total).toBe(2);
  });

  it("caps examples at 20", async () => {
    const rows: AuditRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      size_bytes: i,
      storage_url: `m${i}.pdf`,
    }));
    const deps = singleBatchDeps(rows, async (key) => {
      const i = Number(key.replace(/^m|\.pdf$/g, ""));
      return { contentLength: i + 100 };
    });
    const result = await runAudit(deps);
    expect(result.mismatch).toBe(30);
    expect(result.examples).toHaveLength(20);
  });

  it("strict comparison expects pre-coerced numbers, not bigint strings", async () => {
    // Guards the SELECT-side Number() coercion in main(): if the test deps
    // pass a string size_bytes through, runAudit treats it as mismatch — a
    // signal that callers MUST cast `postgres` int8 strings to Number first.
    const deps = singleBatchDeps(
      [{ id: "s", size_bytes: "12345" as unknown as number, storage_url: "x.pdf" }],
      async () => ({ contentLength: 12345 }),
    );
    const result = await runAudit(deps);
    expect(result.mismatch).toBe(1);
    expect(result.match).toBe(0);
  });

  it("legacy size_bytes=0 rows show as mismatch (not silently skipped)", async () => {
    const deps = singleBatchDeps(
      [{ id: "legacy", size_bytes: 0, storage_url: "old.pdf" }],
      async () => ({ contentLength: 5000 }),
    );
    const result = await runAudit(deps);
    expect(result.mismatch).toBe(1);
    expect(result.examples[0]).toMatchObject({
      id: "legacy",
      recorded: 0,
      actual: 5000,
      delta: 5000,
    });
  });
});
