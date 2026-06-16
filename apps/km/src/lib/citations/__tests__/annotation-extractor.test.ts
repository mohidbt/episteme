import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { reparseSanitizedRawText, sanitizeRefField } from "../parser";

vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(() => ({
    headers: { "X-Inhale-User-Id": "u1", "X-Inhale-Sig": "mock" },
    ts: "1",
  })),
}));

// ---------------------------------------------------------------------------
// These tests cover the regression observed live in prod after commit 26585eb:
//
// `/api/papers/[id]/citations/extract` for the Springer Nature
// "travelling-wave strategy for plant–fungal trade" paper takes the
// annotations branch (annRefs.length >= 3) — NOT the text-regex branch — and
// therefore bypasses parseBibLines + sanitizeRefLine entirely. The agents
// extractor delivers ref 2 / ref 3 with their `.indd:` filename prefix and a
// trail of U+FEFF zero-width no-break spaces still embedded inside rawText,
// and with `title: ""`. The reader UI then falls back to showing the corrupt
// rawText where the title should be ("springernature_nature_8614.indd:2.
// Parniske, M. ...").
//
// The fix exposes sanitizeRefField + reparseSanitizedRawText from parser.ts
// and applies them inside annotation-extractor's toParsedReference.
// ---------------------------------------------------------------------------

describe("sanitizeRefField — agents annotation-extractor scrubbing", () => {
  it("strips InDesign filename prefix", () => {
    expect(sanitizeRefField("springernature_nature_8614.indd:2. Parniske, M."))
      .toBe("2. Parniske, M.");
  });

  it("strips U+FEFF zero-width no-break spaces", () => {
    expect(sanitizeRefField("Parniske,﻿ M.﻿ Arbuscular"))
      .toBe("Parniske, M. Arbuscular");
  });

  it("strips combined prefix + BOMs (the production corruption pattern)", () => {
    const input =
      "springernature_nature_8614.indd:﻿2.﻿﻿ Parniske, M. Arbuscular mycorrhiza: the mother of plant root endosymbioses. Nat. Rev. Microbiol. 6, 763–775 (2008).";
    const out = sanitizeRefField(input);
    expect(out).toBeDefined();
    expect(out).not.toMatch(/\.indd/);
    expect(out).not.toMatch(/﻿/);
    expect(out!.startsWith("2. Parniske")).toBe(true);
  });

  it("returns undefined for null / empty / whitespace-only", () => {
    expect(sanitizeRefField(null)).toBeUndefined();
    expect(sanitizeRefField(undefined)).toBeUndefined();
    expect(sanitizeRefField("")).toBeUndefined();
    expect(sanitizeRefField("   ﻿  ")).toBeUndefined();
  });
});

describe("reparseSanitizedRawText — recover title when agent omitted it", () => {
  it("extracts title from a sanitized rawText that still carries the leading marker token", () => {
    const ref = reparseSanitizedRawText(
      2,
      "2. Parniske, M. Arbuscular mycorrhiza: the mother of plant root endosymbioses. Nat. Rev. Microbiol. 6, 763–775 (2008).",
    );
    expect(ref.markerIndex).toBe(2);
    expect(ref.title ?? "").not.toBe("");
    expect(ref.title ?? "").toMatch(/Arbuscular mycorrhiza/);
    expect(ref.year).toBe("2008");
  });

  it("handles the Wipf-style multi-author Nat. Rev. line", () => {
    const ref = reparseSanitizedRawText(
      3,
      "3. Wipf, D., Krajinski, F., van Tuinen, D., Recorbet, G. & Courty, P. E. Trading on the arbuscular mycorrhiza market. New Phytol. 223, 1127–1142 (2019).",
    );
    expect(ref.title ?? "").not.toBe("");
    expect(ref.title ?? "").toMatch(/arbuscular mycorrhiza market/i);
    expect(ref.year).toBe("2019");
  });
});

describe("extractAnnotationMarkers timeout", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.AGENTS_URL = "http://test-agents:8000";
    process.env.INHALE_INTERNAL_SECRET = "secret";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("aborts after 15s when upstream never responds", { timeout: 20_000 }, async () => {
    const { extractAnnotationMarkers } = await import("../annotation-extractor");
    vi.useFakeTimers();
    let aborted = false;
    global.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;
    try {
      const done = extractAnnotationMarkers("/x.pdf", { userId: "u1" });
      const failed = expect(done).rejects.toThrow(/abort/i);
      await vi.advanceTimersByTimeAsync(15_000);
      await failed;
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
