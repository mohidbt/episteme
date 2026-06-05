export type TourStepId =
  | "drive_intro"
  | "notes_collection"
  | "papers_refs_collection"
  | "agentball_hint"
  | "wow_paper_understanding"
  | "graph_intro"
  | "wow_refs_fill"
  | "wow_reader_highlight"
  | "wow_paper_search"
  | "wow_extract"
  | "signup_cta";

export type TourRunState =
  | "idle"
  | "running"
  | "step_pending"
  | "step_success"
  | "step_fallback"
  | "step_failed"
  | "done"
  | "dismissed";

export type WowRunnerResult = {
  mode: "real" | "fallback";
  durationMs: number;
  errorCode?: string;
};
