// Bulk-import helpers: detect BibTeX / RIS / CSL-JSON and parse to CslItem[].

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";

import { deriveCitationKey, validateCslJson, type CslItem } from "./csl";

export type DetectedFormat = "bibtex" | "ris" | "csl-json";

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function detectFormat(filename: string, content: string): DetectedFormat | null {
  const ext = filename.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (ext === "bib") return "bibtex";
  if (ext === "ris") return "ris";
  if (ext === "json") return "csl-json";

  const text = stripBom(content).trimStart();
  if (text.startsWith("@")) return "bibtex";
  if (/^TY {2}- /m.test(text)) return "ris";
  if (text.startsWith("[") || text.startsWith("{")) return "csl-json";
  return null;
}

/** Derive an `id` for citation-js output when it's missing or non-string. */
function deriveIdIfMissing(item: Record<string, unknown>): Record<string, unknown> {
  if (typeof item.id === "string" && item.id.length > 0) return item;
  // Stub id so validateCslJson lets us pass; derive, then overwrite.
  const stubbed = { ...item, id: "_pending_" };
  const csl = validateCslJson(stubbed);
  return { ...item, id: deriveCitationKey(csl) };
}

export function parseCsl(content: string, format: DetectedFormat): CslItem[] {
  const text = stripBom(content);

  if (format === "csl-json") {
    const parsed = JSON.parse(text);
    const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    // CSL-JSON is strict: every entry must validate as-is (including `id`).
    // Strip _graph in case the JSON was round-tripped through citation-js.
    return arr.map((entry) => {
      const { _graph, ...rest } = entry as Record<string, unknown>;
      return validateCslJson(rest);
    });
  }

  // bibtex / ris → citation-js. Strip _graph (full source blob) before storing.
  const cite = new Cite(text);
  const data = (cite.data ?? []) as Array<Record<string, unknown>>;
  return data.map((entry) => {
    const { _graph, ...rest } = entry;
    return validateCslJson(deriveIdIfMissing(rest));
  });
}
