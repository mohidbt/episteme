import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

export interface CollabProviderArgs {
  noteId: string;
  url: string;
  token: string;
}

export interface CollabProvider {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  destroy: () => void;
}

export function createCollabProvider({ noteId, url, token }: CollabProviderArgs): CollabProvider {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url,
    name: `note:${noteId}`,
    document: ydoc,
    token,
  });
  return {
    ydoc,
    provider,
    destroy: () => {
      provider.destroy();
      ydoc.destroy();
    },
  };
}
