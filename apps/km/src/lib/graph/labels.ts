import type { EdgeKind, NodeKind } from "./types";

function titleCaseWord(word: string): string {
  if (!word) return "";
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

export function formatGraphKindLabel(kind: EdgeKind | NodeKind): string {
  return kind
    .split("_")
    .map(titleCaseWord)
    .join(" ");
}
