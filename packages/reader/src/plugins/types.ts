import type { ReactNode } from "react";

export type ReaderMode = "full" | "lite" | "modal";

export type ReaderPlugin = {
  id: string;
  toolbar?: ReactNode;
  panel?: { id: string; label: string; render: () => ReactNode };
  initState?: () => unknown;
  disabledIn?: ReaderMode[];
};
