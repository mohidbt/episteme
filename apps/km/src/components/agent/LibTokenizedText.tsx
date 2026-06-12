"use client";

// GSD-105 fix-round (Fix 2) — render a user/assistant message text with
// `[lib: ...]` library-handle tokens as inline `.wiki-link` chips. Before
// this, the chat bubble round-tripped the raw text through Streamdown
// markdown, which renders the bracket grammar as plain prose and loses the
// visual handle context the user just picked in the composer.
//
// Why a thin local component instead of routing through Streamdown:
//   - The chip style is a custom inline element, not standard markdown.
//   - The user message bubble is plain text (no other markdown features
//     needed); switching to a custom md plugin would over-abstract.
//   - The host opts into `.episteme-chat-composer` so the same chip CSS
//     (widened in Fix 1) applies without dragging in `.episteme-prose`
//     line-height/font tokens.
//
// Reuses the lib-token grammar from `@/lib/agent/lib-tokens` — single
// source of truth for the [lib: kind= id= title=""] shape.

import { BookMarkedIcon, FileTextIcon } from "lucide-react";
import type { LibraryKind } from "@/lib/agent/lib-tokens";

// Mirror of TOKEN_RE in lib-tokens.ts, with the `g` flag so we can scan
// ALL matches in order. lib-tokens.ts discards positions; we need them
// here so we can interleave with surrounding text runs.
const TOKEN_RE_GLOBAL =
  /\[lib:\s+kind=(?<kind>[a-z]+)\s+id=(?<id>[A-Za-z0-9-]+)\s+title="(?<title>[^"]*)"\]/g;

const KINDS: ReadonlySet<string> = new Set([
  "paper",
  "note",
  "reference",
  "paperset",
]);

interface TokenMatch {
  start: number;
  end: number;
  kind: LibraryKind;
  id: string;
  title: string;
}

function findTokens(text: string): TokenMatch[] {
  const out: TokenMatch[] = [];
  TOKEN_RE_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE_GLOBAL.exec(text)) !== null) {
    const kind = m.groups?.kind;
    const id = m.groups?.id;
    const title = m.groups?.title;
    if (!kind || !id || title === undefined) continue;
    if (!KINDS.has(kind)) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: kind as LibraryKind,
      id,
      title,
    });
  }
  return out;
}

function kindClass(kind: LibraryKind): string {
  // Matches the WikiLink node-view render (packages/markdown/src/tiptap/
  // WikiLink.ts) so chip backgrounds, hover tints, and svg colors are
  // identical between composer + bubble + notes editor.
  if (kind === "paper") return " wiki-link--paper";
  if (kind === "reference") return " wiki-link--reference";
  return "";
}

function ChipIcon({ kind }: { kind: LibraryKind }) {
  // Mirror the icon contract from WikiLink.ts (paper -> FileText,
  // reference -> BookMarked, fallback -> FileText). lucide-react icons
  // render inline svg so the CSS rule `.wiki-link svg { width: 0.875em }`
  // applies.
  if (kind === "reference") return <BookMarkedIcon aria-hidden />;
  return <FileTextIcon aria-hidden />;
}

export interface LibTokenizedTextProps {
  text: string;
  className?: string;
}

export function LibTokenizedText({ text, className }: LibTokenizedTextProps) {
  const tokens = findTokens(text);
  // Host carries `episteme-chat-composer` so the wiki-link CSS rules
  // widened in Fix 1 apply without pulling in `.episteme-prose` typography.
  const hostClass = `episteme-chat-composer whitespace-pre-wrap${
    className ? ` ${className}` : ""
  }`;

  if (tokens.length === 0) {
    return <span className={hostClass}>{text}</span>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((tok, i) => {
    if (tok.start > cursor) {
      parts.push(
        <span key={`t-${i}`}>{text.slice(cursor, tok.start)}</span>,
      );
    }
    parts.push(
      <span
        key={`chip-${i}`}
        className={`wiki-link${kindClass(tok.kind)}`}
        data-type="wiki-link"
        data-target-kind={tok.kind}
        data-target-id={tok.id}
        data-resolved="true"
      >
        <ChipIcon kind={tok.kind} />
        <span className="wiki-link__label">{tok.title}</span>
      </span>,
    );
    cursor = tok.end;
  });
  if (cursor < text.length) {
    parts.push(<span key="t-tail">{text.slice(cursor)}</span>);
  }

  return <span className={hostClass}>{parts}</span>;
}
