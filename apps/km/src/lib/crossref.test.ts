import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { crossRefToCsl, fetchCrossRef } from "./crossref";

describe("fetchCrossRef timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts the request after 15s when upstream never responds", { timeout: 20_000 }, async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn((_url, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }
      });
    }) as unknown as typeof fetch;

    try {
      const promise = fetchCrossRef("10.1/x");
      const failed = expect(promise).rejects.toThrow(/abort/i);
      await vi.advanceTimersByTimeAsync(15_000);
      await failed;
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// Minimal CrossRef message fixture for "Attention Is All You Need"
const vaswaniMessage = {
  DOI: "10.48550/arXiv.1706.03762",
  type: "posted-content",
  title: ["Attention Is All You Need"],
  author: [
    { family: "Vaswani", given: "Ashish", sequence: "first", affiliation: [] },
    { family: "Shazeer", given: "Noam", sequence: "additional", affiliation: [] },
  ],
  issued: { "date-parts": [[2017, 6, 12]] },
  URL: "https://doi.org/10.48550/arXiv.1706.03762",
  publisher: "arXiv",
};

// ── crossRefToCsl: fixture ───────────────────────────────────────────────────

describe("crossRefToCsl fixture: Vaswani 2017", () => {
  it("maps id from DOI", () => {
    const result = crossRefToCsl(vaswaniMessage);
    expect(result.id).toBe("10.48550/arXiv.1706.03762");
  });

  it("maps type posted-content → article", () => {
    const result = crossRefToCsl(vaswaniMessage);
    expect(result.type).toBe("article");
  });

  it("maps title from title[0]", () => {
    const result = crossRefToCsl(vaswaniMessage);
    expect(result.title).toBe("Attention Is All You Need");
  });

  it("maps first author family and given", () => {
    const result = crossRefToCsl(vaswaniMessage);
    expect(result.author![0].family).toBe("Vaswani");
    expect(result.author![0].given).toBe("Ashish");
  });

  it("maps issued date-parts", () => {
    const result = crossRefToCsl(vaswaniMessage);
    expect(result.issued!["date-parts"]![0][0]).toBe(2017);
  });

  it("maps DOI field", () => {
    const result = crossRefToCsl(vaswaniMessage);
    expect(result.DOI).toBe("10.48550/arXiv.1706.03762");
  });
});

// ── crossRefToCsl: type mapping ──────────────────────────────────────────────

describe("crossRefToCsl type mapping", () => {
  function typeMsg(crossRefType: string) {
    return { ...vaswaniMessage, type: crossRefType };
  }

  it("journal-article → article-journal", () => {
    expect(crossRefToCsl(typeMsg("journal-article")).type).toBe("article-journal");
  });

  it("proceedings-article → paper-conference", () => {
    expect(crossRefToCsl(typeMsg("proceedings-article")).type).toBe("paper-conference");
  });

  it("book-chapter → chapter", () => {
    expect(crossRefToCsl(typeMsg("book-chapter")).type).toBe("chapter");
  });

  it("posted-content → article", () => {
    expect(crossRefToCsl(typeMsg("posted-content")).type).toBe("article");
  });

  it("unknown type passes through as-is", () => {
    expect(crossRefToCsl(typeMsg("dataset")).type).toBe("dataset");
  });
});

// ── crossRefToCsl: author shape variants ────────────────────────────────────

describe("crossRefToCsl author shapes", () => {
  it("author with family + given produces { family, given }", () => {
    const msg = {
      ...vaswaniMessage,
      author: [{ family: "Smith", given: "John", affiliation: [] }],
    };
    const result = crossRefToCsl(msg);
    expect(result.author![0]).toEqual({ family: "Smith", given: "John" });
  });

  it("author with only name produces { literal: name }", () => {
    const msg = {
      ...vaswaniMessage,
      author: [{ name: "The IEEE", affiliation: [] }],
    };
    const result = crossRefToCsl(msg);
    expect(result.author![0]).toEqual({ literal: "The IEEE" });
  });

  it("author with family only (no given) produces { family }", () => {
    const msg = {
      ...vaswaniMessage,
      author: [{ family: "Anonymous", affiliation: [] }],
    };
    const result = crossRefToCsl(msg);
    expect(result.author![0]).toEqual({ family: "Anonymous" });
  });
});

// ── crossRefToCsl: date fallback order ──────────────────────────────────────

describe("crossRefToCsl date fallback order", () => {
  const baseMsg = { ...vaswaniMessage };

  it("prefers issued over published", () => {
    const msg = {
      ...baseMsg,
      issued: { "date-parts": [[2017]] },
      published: { "date-parts": [[2018]] },
    };
    expect(crossRefToCsl(msg).issued!["date-parts"]![0][0]).toBe(2017);
  });

  it("falls back to published when issued absent", () => {
    const { issued: _issued, ...msgWithout } = baseMsg as any;
    const msg = { ...msgWithout, published: { "date-parts": [[2018]] } };
    expect(crossRefToCsl(msg).issued!["date-parts"]![0][0]).toBe(2018);
  });

  it("falls back to published-print when issued and published absent", () => {
    const { issued: _issued, ...msgWithout } = baseMsg as any;
    const msg = {
      ...msgWithout,
      "published-print": { "date-parts": [[2019]] },
      "published-online": { "date-parts": [[2020]] },
    };
    expect(crossRefToCsl(msg).issued!["date-parts"]![0][0]).toBe(2019);
  });

  it("falls back to published-online when all others absent", () => {
    const { issued: _issued, ...msgWithout } = baseMsg as any;
    const msg = {
      ...msgWithout,
      "published-online": { "date-parts": [[2020]] },
    };
    expect(crossRefToCsl(msg).issued!["date-parts"]![0][0]).toBe(2020);
  });

  it("omits issued field entirely when no date source present", () => {
    const { issued: _issued, ...msgWithout } = baseMsg as any;
    const result = crossRefToCsl(msgWithout);
    expect(result.issued).toBeUndefined();
  });
});

// ── crossRefToCsl: missing DOI throws ───────────────────────────────────────

describe("crossRefToCsl validation", () => {
  it("throws when DOI is missing", () => {
    expect(() => crossRefToCsl({ title: ["Some Title"] })).toThrow();
  });

  it("throws when DOI is not a string", () => {
    expect(() => crossRefToCsl({ DOI: 123, title: ["t"], type: "misc" })).toThrow();
  });
});

// ── fetchCrossRef: mocked fetch ──────────────────────────────────────────────

describe("fetchCrossRef", () => {
  const testDoi = "10.48550/arXiv.1706.03762";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns CSL item on 200 and fetches correct URL with User-Agent", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ status: "ok", message: vaswaniMessage }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchCrossRef(testDoi);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(testDoi);

    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain(encodeURIComponent(testDoi));

    const calledInit: RequestInit = mockFetch.mock.calls[0][1];
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Episteme/0.1 (mailto:team@episteme.local)");
  });

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    const result = await fetchCrossRef(testDoi);
    expect(result).toBeNull();
  });

  it("throws on 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500 }));
    await expect(fetchCrossRef(testDoi)).rejects.toThrow();
  });
});
