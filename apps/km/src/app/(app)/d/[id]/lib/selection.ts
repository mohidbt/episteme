/**
 * Pure cell-selection model for the paperset grid.
 *
 * Tracks a set of (row, col) cell coordinates with click / cmd-click /
 * shift-click / row / column gestures. Filled cells are never added to the
 * selection — selection is for "empty cells eligible for enrichment" only.
 *
 * No React, no DOM. Mutates internal state in place.
 */

export type Cell = { row: number; col: string };

export interface CellSelectionOpts {
  /** Set of "row:col" keys that already have a value — never selectable. */
  filledKeys: Set<string>;
  /** Total number of rows. */
  rowCount: number;
  /** Ordered list of column names. */
  cols: string[];
}

export type SelectionKind =
  | { kind: "none" }
  | { kind: "cells" }
  | { kind: "row"; row: number }
  | { kind: "col"; col: string };

export class CellSelection {
  private set = new Set<string>();
  private anchor: string | null = null;
  private lastKind: SelectionKind = { kind: "none" };

  constructor(private opts: CellSelectionOpts) {}

  getKind(): SelectionKind {
    if (this.set.size === 0) return { kind: "none" };
    return this.lastKind.kind === "none" ? { kind: "cells" } : this.lastKind;
  }

  private key(c: Cell): string {
    return `${c.row}:${c.col}`;
  }

  private isFilled(c: Cell): boolean {
    return this.opts.filledKeys.has(this.key(c));
  }

  click(c: Cell): void {
    this.set.clear();
    if (!this.isFilled(c)) {
      const k = this.key(c);
      this.set.add(k);
      this.anchor = k;
    } else {
      this.anchor = null;
    }
    this.lastKind = { kind: "cells" };
  }

  cmdClick(c: Cell): void {
    if (this.isFilled(c)) return;
    const k = this.key(c);
    if (this.set.has(k)) {
      this.set.delete(k);
    } else {
      this.set.add(k);
      this.anchor = k;
    }
    this.lastKind = { kind: "cells" };
  }

  shiftClick(to: Cell): void {
    if (!this.anchor) {
      this.click(to);
      return;
    }
    this.lastKind = { kind: "cells" };
    const [r1s, c1] = this.anchor.split(":");
    const r1 = Number.parseInt(r1s, 10);
    const colIdx = (n: string) => this.opts.cols.indexOf(n);
    const r0 = Math.min(r1, to.row);
    const rN = Math.max(r1, to.row);
    const c0 = Math.min(colIdx(c1), colIdx(to.col));
    const cN = Math.max(colIdx(c1), colIdx(to.col));
    for (let r = r0; r <= rN; r++) {
      for (let ci = c0; ci <= cN; ci++) {
        const cand: Cell = { row: r, col: this.opts.cols[ci] };
        if (!this.isFilled(cand)) this.set.add(this.key(cand));
      }
    }
  }

  clickRow(row: number): void {
    this.set.clear();
    for (const col of this.opts.cols) {
      const c = { row, col };
      if (!this.isFilled(c)) this.set.add(this.key(c));
    }
    this.anchor = null;
    this.lastKind =
      this.set.size > 0 ? { kind: "row", row } : { kind: "none" };
  }

  clickCol(col: string): void {
    this.set.clear();
    for (let r = 0; r < this.opts.rowCount; r++) {
      const c = { row: r, col };
      if (!this.isFilled(c)) this.set.add(this.key(c));
    }
    this.anchor = null;
    this.lastKind =
      this.set.size > 0 ? { kind: "col", col } : { kind: "none" };
  }

  list(): Cell[] {
    return [...this.set].map((k) => {
      const [r, c] = k.split(":");
      return { row: Number.parseInt(r, 10), col: c };
    });
  }

  size(): number {
    return this.set.size;
  }

  isEmpty(): boolean {
    return this.set.size === 0;
  }

  has(c: Cell): boolean {
    return this.set.has(this.key(c));
  }

  /**
   * Replace the underlying grid options. Drops any selected cells that are
   * now filled or out-of-range. Used after SSE updates rewrite the grid.
   */
  setOpts(next: CellSelectionOpts): void {
    this.opts = next;
    for (const k of [...this.set]) {
      const [r, c] = k.split(":");
      const row = Number.parseInt(r, 10);
      if (
        row >= next.rowCount ||
        !next.cols.includes(c) ||
        next.filledKeys.has(k)
      ) {
        this.set.delete(k);
      }
    }
    if (this.anchor && !this.set.has(this.anchor)) {
      this.anchor = null;
    }
    if (this.set.size === 0) this.lastKind = { kind: "none" };
  }
}
