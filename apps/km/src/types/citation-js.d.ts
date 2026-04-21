// Minimal ambient types for @citation-js/core + its format plugins.
// Upstream ships no .d.ts files. We only need `Cite` enough for parsing.

declare module "@citation-js/core" {
  export class Cite {
    constructor(input: unknown);
    data: Array<Record<string, unknown>>;
  }
  export const plugins: unknown;
}

declare module "@citation-js/plugin-bibtex";
declare module "@citation-js/plugin-ris";
