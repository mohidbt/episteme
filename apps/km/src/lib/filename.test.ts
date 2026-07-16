import { describe, expect, it } from "vitest";
import {
  archiveRelativePath,
  attachmentContentDisposition,
  sanitizeArchiveSegment,
  sanitizeFilename,
} from "./filename";

describe("filename security", () => {
  it("removes path components and control characters", () => {
    expect(sanitizeFilename(" ../nested\\evil\r\n.pdf ")).toBe("evil.pdf");
  });

  it("cannot inject or escape an attachment header", () => {
    const value = attachmentContentDisposition('report"\r\nX-Evil: yes.zip');

    expect(value).not.toContain("\r");
    expect(value).not.toContain("\n");
    expect(value).not.toContain('filename="report"');
    expect(value).toContain('filename="report_X-Evil: yes.zip"');
  });

  it("emits an RFC 5987 UTF-8 filename", () => {
    const value = attachmentContentDisposition("résumé.zip");
    expect(value).toContain('filename="r_sum_.zip"');
    expect(value).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.zip");
  });
});

describe("ZIP entry path hygiene", () => {
  it("normalizes safe folder separators and sanitizes hostile segments", () => {
    expect(archiveRelativePath("projects\\phd/", "paper.pdf")).toBe(
      "projects/phd/paper.pdf",
    );
    expect(sanitizeArchiveSegment("evil:name. ")).toBe("evil_name");
  });

  it("rejects absolute, traversal, drive, and control-bearing folders", () => {
    expect(archiveRelativePath("../private/", "paper.pdf")).toBeNull();
    expect(archiveRelativePath("/etc/", "paper.pdf")).toBeNull();
    expect(archiveRelativePath("C:\\temp\\", "paper.pdf")).toBeNull();
    expect(archiveRelativePath("safe\u0000/escape/", "paper.pdf")).toBeNull();
  });

  it("never returns dot-segment leaves", () => {
    expect(archiveRelativePath("safe/", "..")).toBe("safe/item");
    expect(archiveRelativePath("", ".")).toBe("item");
  });
});
