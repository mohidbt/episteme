import { useCallback, useMemo, useRef } from "react";
import {
  buildMarkdownWithFrontmatter,
  parseFrontmatter,
  type FrontmatterRow,
} from "@episteme/markdown";

/**
 * Frontmatter rows live outside the editor. Split them off the stored
 * markdown and re-attach them to the editor's body on save, so they are never
 * dropped.
 */
export function useNoteFrontmatter(initialMd: string) {
  const parsed = useMemo(() => parseFrontmatter(initialMd), [initialMd]);
  const rowsRef = useRef<FrontmatterRow[]>(parsed.rows);
  const transformMd = useCallback(
    (body: string) => buildMarkdownWithFrontmatter(rowsRef.current, body),
    [],
  );
  return { body: parsed.body, transformMd };
}
