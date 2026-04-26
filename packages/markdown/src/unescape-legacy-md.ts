/**
 * Strips tiptap-markdown's defensive backslash-escaping from legacy content.
 *
 * tiptap-markdown serializes plain text through prosemirror-markdown's `esc()`
 * function, which backslash-escapes characters that are syntactically special
 * in Markdown. After multiple save/load cycles this freezes the escapes as
 * literal text (e.g. `1\. \*\*foo\*\*` instead of `1. **foo**`).
 *
 * This function strips those escapes from non-code regions so markdown-it
 * (or tiptap-markdown's parser) can render them correctly.
 *
 * Rules:
 * - Strips `\` before: `*`, `_`, `.`, `[`, `]`, `(`, `)`, `#`, `+`, `-`, `>`, `|`, `~`, backtick, `!`
 * - Skips fenced code blocks (``` ... ```) and inline code spans (` ... `)
 * - Preserves `\\` (escaped backslash) — never touches double-backslash
 * - Idempotent: applying twice is the same as applying once
 */
export function unescapeLegacyMd(md: string): string {
  if (!md) return md;

  // Characters that tiptap-markdown/prosemirror-markdown escape unnecessarily.
  // Lookbehind ensures we don't match `\\x` (escaped backslash followed by x).
  const ESCAPABLE = /(?<!\\)\\([*_.\[\]()\#+\->|~`!])/g;

  // We split on code regions (fenced blocks and inline code), process only the
  // non-code segments, then reassemble.
  const segments = splitOnCode(md);

  return segments
    .map((seg) => {
      if (seg.isCode) return seg.text;
      return seg.text.replace(ESCAPABLE, "$1");
    })
    .join("");
}

type Segment = { text: string; isCode: boolean };

/**
 * Splits a markdown string into alternating non-code / code segments.
 * Fenced blocks take priority over inline code.
 */
function splitOnCode(md: string): Segment[] {
  const segments: Segment[] = [];
  // Match fenced blocks first, then inline backtick spans.
  const codePattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~)|(`+[\s\S]*?`+)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(md)) !== null) {
    const codeText = match[0];
    const codeStart = match.index;

    // Push the non-code text before this code region
    if (codeStart > lastIndex) {
      segments.push({ text: md.slice(lastIndex, codeStart), isCode: false });
    }

    // Push the code region itself
    segments.push({ text: codeText, isCode: true });
    lastIndex = codeStart + codeText.length;
  }

  // Push any remaining non-code text
  if (lastIndex < md.length) {
    segments.push({ text: md.slice(lastIndex), isCode: false });
  }

  return segments.length > 0 ? segments : [{ text: md, isCode: false }];
}
