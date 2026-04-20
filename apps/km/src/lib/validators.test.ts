import { describe, expect, it } from "vitest";
import {
  libraryCreateSchema,
  noteLinkCreateSchema,
  paperCreateSchema,
  referenceCreateSchema,
} from "./validators";

const baseRef = {
  libraryId: 1,
  cslJson: { type: "article-journal" },
};

const basePaper = {
  libraryId: 1,
  filename: "a.pdf",
  storageUrl: "s3://x/a.pdf",
  title: "A",
};

const currentYear = new Date().getFullYear();

describe("paperCreateSchema year boundaries", () => {
  it("rejects year 999", () => {
    const r = paperCreateSchema.safeParse({ ...basePaper, year: 999 });
    expect(r.success).toBe(false);
  });
  it("accepts year 1000", () => {
    const r = paperCreateSchema.safeParse({ ...basePaper, year: 1000 });
    expect(r.success).toBe(true);
  });
  it("accepts year currentYear+1", () => {
    const r = paperCreateSchema.safeParse({ ...basePaper, year: currentYear + 1 });
    expect(r.success).toBe(true);
  });
  it("rejects year currentYear+2", () => {
    const r = paperCreateSchema.safeParse({ ...basePaper, year: currentYear + 2 });
    expect(r.success).toBe(false);
  });
});

describe("referenceCreateSchema citationKey", () => {
  it("rejects citation key with space", () => {
    const r = referenceCreateSchema.safeParse({ ...baseRef, citationKey: "has space" });
    expect(r.success).toBe(false);
  });
  it("accepts alnum/underscore/colon/hyphen", () => {
    const r = referenceCreateSchema.safeParse({ ...baseRef, citationKey: "Smith_2020:chap-1" });
    expect(r.success).toBe(true);
  });
  it("rejects empty citation key", () => {
    const r = referenceCreateSchema.safeParse({ ...baseRef, citationKey: "" });
    expect(r.success).toBe(false);
  });
});

describe("noteLinkCreateSchema targetTitleRaw", () => {
  it("rejects empty targetTitleRaw", () => {
    const r = noteLinkCreateSchema.safeParse({
      sourceNoteId: "00000000-0000-0000-0000-000000000000",
      targetKind: "note",
      targetTitleRaw: "",
    });
    expect(r.success).toBe(false);
  });
  it("rejects whitespace-only targetTitleRaw", () => {
    const r = noteLinkCreateSchema.safeParse({
      sourceNoteId: "00000000-0000-0000-0000-000000000000",
      targetKind: "note",
      targetTitleRaw: "   ",
    });
    expect(r.success).toBe(false);
  });
});

describe("libraryCreateSchema name trimming", () => {
  it("trims leading/trailing whitespace", () => {
    const r = libraryCreateSchema.safeParse({ name: "  My Lib  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("My Lib");
  });
  it("rejects whitespace-only name", () => {
    const r = libraryCreateSchema.safeParse({ name: "   " });
    expect(r.success).toBe(false);
  });
});
