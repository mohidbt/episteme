// GSD-72: Tests for pure CSL→paper-columns merge helper.
// When a reference's CSL JSON changes, we want to propagate the *changed*
// fields onto the bound paper row. This file exercises the diff/coerce logic
// in isolation (no DB).

import { describe, it, expect } from "vitest";
import { mergeRefCslIntoPaper } from "../merge-ref-csl-into-paper";

describe("mergeRefCslIntoPaper", () => {
  it("returns empty patch when CSL is identical", () => {
    const csl = { title: "Same", DOI: "10.1/x" };
    expect(mergeRefCslIntoPaper(csl, csl)).toEqual({});
  });

  it("propagates a changed title", () => {
    const prev = { title: "Old" };
    const next = { title: "New" };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({ title: "New" });
  });

  it("formats authors with {family, given}", () => {
    const prev = {};
    const next = {
      author: [
        { family: "Vaswani", given: "Ashish" },
        { family: "Shazeer", given: "Noam" },
      ],
    };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({
      authors: ["Vaswani, Ashish", "Shazeer, Noam"],
    });
  });

  it("formats authors with {literal}", () => {
    const prev = {};
    const next = { author: [{ literal: "DeepMind Authors" }] };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({
      authors: ["DeepMind Authors"],
    });
  });

  it("formats authors with {name} (S2 shape)", () => {
    const prev = {};
    const next = { author: [{ name: "A. Vaswani" }] };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({
      authors: ["A. Vaswani"],
    });
  });

  it("falls back to family-only when given is missing", () => {
    const prev = {};
    const next = { author: [{ family: "Knuth" }] };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({
      authors: ["Knuth"],
    });
  });

  it("coerces year string to int", () => {
    const prev = {};
    const next = { issued: { "date-parts": [["2020"]] } };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({ year: 2020 });
  });

  it("accepts numeric year", () => {
    const prev = {};
    const next = { issued: { "date-parts": [[2017]] } };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({ year: 2017 });
  });

  it("skips malformed (non-numeric) year, does not throw", () => {
    const prev = {};
    const next = { issued: { "date-parts": [["twenty-twenty"]] } };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({});
  });

  it("propagates DOI", () => {
    const prev = {};
    const next = { DOI: "10.48550/arXiv.1706.03762" };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({
      doi: "10.48550/arXiv.1706.03762",
    });
  });

  it("trims abstract to 500 chars and maps to abstractShort", () => {
    const prev = {};
    const next = { abstract: "x".repeat(2000) };
    const out = mergeRefCslIntoPaper(prev, next);
    expect(typeof out.abstractShort).toBe("string");
    expect((out.abstractShort as string).length).toBeLessThanOrEqual(500);
  });

  it("maps container-title string to venue", () => {
    const prev = {};
    const next = { "container-title": "NeurIPS" };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({ venue: "NeurIPS" });
  });

  it("maps container-title array to venue (first element)", () => {
    const prev = {};
    const next = { "container-title": ["NeurIPS 2017", "NIPS"] };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({ venue: "NeurIPS 2017" });
  });

  it("skips fields whose normalized value is unchanged", () => {
    const prev = { title: "Same", DOI: "10.1/x" };
    const next = { title: "Same", DOI: "10.1/x", abstract: "" };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({});
  });

  it("propagates multiple changed fields together", () => {
    const prev = { title: "Old", DOI: "10.1/old" };
    const next = {
      title: "New",
      DOI: "10.1/new",
      "container-title": "Nature",
    };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({
      title: "New",
      doi: "10.1/new",
      venue: "Nature",
    });
  });

  it("handles null/undefined prev (first edit of a CSL-less ref)", () => {
    const next = { title: "Hello" };
    expect(mergeRefCslIntoPaper(null, next)).toEqual({ title: "Hello" });
    expect(mergeRefCslIntoPaper(undefined, next)).toEqual({ title: "Hello" });
  });

  it("skips empty-string title (treats as no-op vs prev set)", () => {
    const prev = { title: "Real Title" };
    const next = { title: "   " };
    // Trimmed empty -> we don't write empty over real title.
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({});
  });

  it("drops authors with no usable name shape", () => {
    const prev = {};
    const next = { author: [{ family: "Knuth" }, { foo: "bar" }] };
    expect(mergeRefCslIntoPaper(prev, next)).toEqual({
      authors: ["Knuth"],
    });
  });
});
