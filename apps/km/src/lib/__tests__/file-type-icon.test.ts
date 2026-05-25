import { describe, it, expect } from "vitest";
import {
  Folder,
  FileText,
  BookMarked,
  NotebookPen,
  Network,
  Table2,
  MessagesSquare,
  UserCog,
  Database,
  Palette,
  ShieldCheck,
  Cog,
  Trash2,
  Tag,
} from "lucide-react";
import { fileTypeKindFromHref, getFileTypeIcon } from "../file-type-icon";

describe("fileTypeKindFromHref — sidebar route coverage", () => {
  it("maps / (Drive home) to drive", () => {
    expect(fileTypeKindFromHref("/")).toBe("drive");
  });

  it("maps /papers (list) to paper", () => {
    expect(fileTypeKindFromHref("/papers")).toBe("paper");
  });

  it("maps /references (list) to reference", () => {
    expect(fileTypeKindFromHref("/references")).toBe("reference");
  });

  it("maps exact /notes (list) to notes-list", () => {
    expect(fileTypeKindFromHref("/notes")).toBe("notes-list");
  });

  it("maps /n/<slug> (single note) to note", () => {
    expect(fileTypeKindFromHref("/n/welcome")).toBe("note");
  });

  it("maps /graph to graph", () => {
    expect(fileTypeKindFromHref("/graph")).toBe("graph");
  });

  it("maps /papersets to paperset", () => {
    expect(fileTypeKindFromHref("/papersets")).toBe("paperset");
  });

  it("maps /agents to agent", () => {
    expect(fileTypeKindFromHref("/agents")).toBe("agent");
  });

  // Settings: specific paths MUST resolve before generic /settings
  it("maps /settings/account to settings-account (specific before generic)", () => {
    expect(fileTypeKindFromHref("/settings/account")).toBe("settings-account");
  });

  it("maps /settings/data to settings-data", () => {
    expect(fileTypeKindFromHref("/settings/data")).toBe("settings-data");
  });

  it("maps /settings/appearance to settings-appearance", () => {
    expect(fileTypeKindFromHref("/settings/appearance")).toBe(
      "settings-appearance",
    );
  });

  it("maps /settings/agents to settings-agents", () => {
    expect(fileTypeKindFromHref("/settings/agents")).toBe("settings-agents");
  });

  it("maps bare /settings to settings (generic fallback)", () => {
    expect(fileTypeKindFromHref("/settings")).toBe("settings");
  });

  it("maps /trash to trash", () => {
    expect(fileTypeKindFromHref("/trash")).toBe("trash");
  });

  it("maps /tags/foo to tag", () => {
    expect(fileTypeKindFromHref("/tags/foo")).toBe("tag");
  });
});

describe("getFileTypeIcon — sidebar parity", () => {
  it("drive → Folder", () => {
    expect(getFileTypeIcon("drive")).toBe(Folder);
  });

  it("paper → FileText", () => {
    expect(getFileTypeIcon("paper")).toBe(FileText);
  });

  it("reference → BookMarked", () => {
    expect(getFileTypeIcon("reference")).toBe(BookMarked);
  });

  it("note → NotebookPen (matches /notes sidebar icon)", () => {
    expect(getFileTypeIcon("note")).toBe(NotebookPen);
  });

  it("notes-list → NotebookPen", () => {
    expect(getFileTypeIcon("notes-list")).toBe(NotebookPen);
  });

  it("graph → Network", () => {
    expect(getFileTypeIcon("graph")).toBe(Network);
  });

  it("paperset → Table2", () => {
    expect(getFileTypeIcon("paperset")).toBe(Table2);
  });

  it("agent → MessagesSquare (matches sidebar Convos row)", () => {
    expect(getFileTypeIcon("agent")).toBe(MessagesSquare);
  });

  it("settings-account → UserCog", () => {
    expect(getFileTypeIcon("settings-account")).toBe(UserCog);
  });

  it("settings-data → Database", () => {
    expect(getFileTypeIcon("settings-data")).toBe(Database);
  });

  it("settings-appearance → Palette", () => {
    expect(getFileTypeIcon("settings-appearance")).toBe(Palette);
  });

  it("settings-agents → ShieldCheck", () => {
    expect(getFileTypeIcon("settings-agents")).toBe(ShieldCheck);
  });

  it("settings → Cog (sidebar section header)", () => {
    expect(getFileTypeIcon("settings")).toBe(Cog);
  });

  it("trash → Trash2", () => {
    expect(getFileTypeIcon("trash")).toBe(Trash2);
  });

  it("tag → Tag", () => {
    expect(getFileTypeIcon("tag")).toBe(Tag);
  });
});
