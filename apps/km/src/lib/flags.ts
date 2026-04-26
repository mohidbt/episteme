// Read collab flag at build time so server + client agree.
export const COLLAB_ENABLED = process.env.NEXT_PUBLIC_COLLAB === "1";

export const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:1234";
