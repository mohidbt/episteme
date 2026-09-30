// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderNote } from "./useReaderNote";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useReaderNote", () => {
  it("starts closed with no note", () => {
    const { result } = renderHook(() => useReaderNote("paper-a"));
    expect(result.current.noteId).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it("keeps each paper's entry apart", () => {
    const a = renderHook(() => useReaderNote("paper-a"));
    act(() => {
      a.result.current.setNoteId("note-1");
      a.result.current.setOpen(true);
    });
    const b = renderHook(() => useReaderNote("paper-b"));
    expect(b.result.current.noteId).toBeNull();
    expect(b.result.current.open).toBe(false);
    expect(JSON.parse(window.localStorage.getItem("reader-notes:v1:paper-a")!)).toEqual({
      noteId: "note-1",
      open: true,
    });
    expect(window.localStorage.getItem("reader-notes:v1:paper-b")).toBeNull();
  });

  it("restores the entry on the next visit", () => {
    window.localStorage.setItem(
      "reader-notes:v1:paper-a",
      JSON.stringify({ noteId: "note-1", open: true }),
    );
    const { result } = renderHook(() => useReaderNote("paper-a"));
    expect(result.current.noteId).toBe("note-1");
    expect(result.current.open).toBe(true);
  });

  it("clears the note and keeps the open state", () => {
    const { result } = renderHook(() => useReaderNote("paper-a"));
    act(() => {
      result.current.setOpen(true);
      result.current.setNoteId("note-1");
    });
    act(() => result.current.setNoteId(null));
    expect(result.current.noteId).toBeNull();
    expect(result.current.open).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("reader-notes:v1:paper-a")!)).toEqual({
      noteId: null,
      open: true,
    });
  });

  it("ignores a corrupt entry", () => {
    window.localStorage.setItem("reader-notes:v1:paper-a", "{not json");
    const { result } = renderHook(() => useReaderNote("paper-a"));
    expect(result.current.noteId).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it("works for the current visit when storage throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useReaderNote("paper-a"));
    act(() => {
      result.current.setOpen(true);
      result.current.setNoteId("note-1");
    });
    expect(result.current.noteId).toBe("note-1");
    expect(result.current.open).toBe(true);
  });
});
