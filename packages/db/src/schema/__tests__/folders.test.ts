import { describe, it, expect } from "vitest";
import { folders } from "../folders";
import { papers } from "../papers";
import { notes } from "../notes";
import { references_ } from "../references";

describe("folders schema", () => {
  it("exports a table named folders with the expected columns", () => {
    const cols = Object.keys(folders);
    for (const k of [
      "id",
      "libraryId",
      "userId",
      "parentId",
      "name",
      "isTrash",
      "sortOrder",
      "createdAt",
      "updatedAt",
    ])
      expect(cols).toContain(k);
  });

  it("adds folderId and prevFolderId to papers/notes/references", () => {
    for (const t of [papers, notes, references_]) {
      expect(Object.keys(t)).toContain("folderId");
      expect(Object.keys(t)).toContain("prevFolderId");
    }
  });
});
