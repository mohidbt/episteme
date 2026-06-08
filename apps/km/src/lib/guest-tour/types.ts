export type TourStepId =
  | "drive_intro"
  | "notes_collection"
  | "open_welcome_note"
  | "references_collection"
  | "wow_refs_fill"
  | "open_reference"
  | "wow_paper_search"
  | "papers_collection"
  | "open_seed_paper"
  | "open_seed_paper_reader"
  | "wow_reader_highlight"
  | "open_seed_paperset"
  | "wow_extract"
  | "agentball_hint"
  | "wow_paper_understanding"
  | "graph_intro"
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
