// Minimal markdown-it surface we touch from `storage.markdown.parse.setup`
// hooks on custom extensions (WikiLink, TagMark, ...). We intentionally avoid
// pulling in @types/markdown-it for a couple of hooks; only the members below
// are used. Shared so multiple extensions don't redeclare the same shape.

export interface MdInlineState {
  src: string;
  pos: number;
  posMax: number;
  push(type: string, tag: string, nesting: number): { meta: unknown };
}

export interface MdInlineRuler {
  after(
    before: string,
    name: string,
    rule: (state: MdInlineState, silent: boolean) => boolean,
  ): void;
  before(
    after: string,
    name: string,
    rule: (state: MdInlineState, silent: boolean) => boolean,
  ): void;
}

export interface MdToken {
  meta: unknown;
}

export interface MdLike {
  inline: { ruler: MdInlineRuler };
  renderer: {
    rules: Record<string, (tokens: MdToken[], idx: number) => string>;
  };
  utils: { escapeHtml: (s: string) => string };
}
