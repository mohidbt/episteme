import { describe, it, expect } from "vitest";
import { derivePageContext } from "./page-context";

describe("derivePageContext", () => {
  it("maps /p/:id to paperId", () => {
    expect(derivePageContext("/p/abc")).toEqual({ paperId: "abc" });
  });

  it("maps /papers/:id to paperId", () => {
    expect(derivePageContext("/papers/x1")).toEqual({ paperId: "x1" });
  });

  it("maps /n/:slug to noteId", () => {
    expect(derivePageContext("/n/my-note")).toEqual({ noteId: "my-note" });
  });

  it("maps /notes/:id to noteId", () => {
    expect(derivePageContext("/notes/n2")).toEqual({ noteId: "n2" });
  });

  it("maps /datasets/:id to datasetId", () => {
    expect(derivePageContext("/datasets/d1")).toEqual({ datasetId: "d1" });
  });

  it("maps /folders/:id to folderId", () => {
    expect(derivePageContext("/folders/f1")).toEqual({ folderId: "f1" });
  });

  it("returns empty for unrelated paths", () => {
    expect(derivePageContext("/")).toEqual({});
    expect(derivePageContext("/agent/settings")).toEqual({});
    expect(derivePageContext("/notes")).toEqual({});
    expect(derivePageContext("")).toEqual({});
  });

  it("ignores trailing slash", () => {
    expect(derivePageContext("/n/abc/")).toEqual({ noteId: "abc" });
  });
});
