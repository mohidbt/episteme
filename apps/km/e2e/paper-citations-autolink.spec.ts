/**
 * E2E — `paper_citations` polymorphic edges + auto-link automation
 *
 * Status: DESIGN DRAFT. The harness depends on three unsolved pieces; until
 * they land the spec is marked `test.skip()` so it surfaces in the suite as
 * a TODO without failing CI. See the comment blocks below.
 *
 * What this spec is meant to prove (per plan #34):
 *
 *   1. Uploading two papers where paper B's DOI/title matches one of paper
 *      A's references causes the auto-link path (run from the extract
 *      route's `after()` callback) to write a polymorphic edge:
 *        paper_citations(citer_kind='paper', citer_id=A,
 *                        cited_kind='paper', cited_id=B,
 *                        match_method ∈ {'doi','title-fuzzy'})
 *
 *   2. The same flow also writes a paper→reference edge for refs that
 *      have no matching paper in the library.
 *
 *   3. The rematch endpoint (`POST /api/papers/:id/citations/rematch`)
 *      can re-run auto-link idempotently — duplicate edges are NOT created
 *      (UNIQUE (citer_kind, citer_id, cited_kind, cited_id) protects us).
 *
 *   4. Edges are user-scoped: a second user with the same DOI does NOT
 *      see cross-user edges.
 *
 * ---
 *
 * Harness gaps (block running this spec):
 *
 * A. **PDF fixtures with overlapping DOIs.** We need two real (or
 *    deterministically-mocked) PDFs whose bibliographies share at least
 *    one DOI. The existing `reader-test_real_paper.pdf` doesn't pair.
 *    Either:
 *      - check in two PDFs designed for this pairing (preferred), OR
 *      - mock the agent-service `/pdf/annotations` + `/pdf/pages` HTTP
 *        endpoints via `page.route()` so the extract route gets canned
 *        reference rows without needing a real PDF.
 *
 * B. **`after()` is not awaitable from the client.** The auto-link runs
 *    post-response. The spec must poll `/api/graph/edges?direction=…`
 *    until the new edge appears, with a sane timeout (~30s on prod-like
 *    instance, ~5s on CI). Bake a `waitForEdge(citerId, citedId)` helper
 *    that uses `expect.poll`.
 *
 * C. **Auto-link runs across S2 too — needs network mock.** The chunked
 *    enrichment in `enrichPaperReferencesInDb` fires alongside auto-link.
 *    Mock `https://api.semanticscholar.org/**` via `page.route()` to avoid
 *    flake from real S2 rate limits.
 *
 * ---
 *
 * Sketch of the assertions (`test.skip()` until the harness is unblocked):
 *
 *   1) Login as user A, upload paper-A.pdf. Wait extract done.
 *   2) GET /api/papers/<A>/citations → assert ref-row exists for known DOI.
 *   3) Upload paper-B.pdf (DOI matches one of A's refs). Wait extract done.
 *   4) Poll /api/graph/edges?paperId=<A>&direction=cited-in until it
 *      contains an edge to <B> with match_method='doi'.
 *   5) Trigger POST /api/papers/<A>/citations/rematch → assert response 200
 *      AND edge count unchanged (idempotent UNIQUE constraint).
 *   6) Login as user B (separate account), upload paper-B.pdf w/ same DOI.
 *      Assert their /api/graph/edges does NOT include user A's paper.
 *
 * ---
 *
 * Open questions for whoever picks this up:
 *
 *   - Where should fixture PDFs live? Probably `fixtures/auto-link/{A,B}.pdf`
 *     with a `fixtures/auto-link/README.md` documenting the DOI overlap.
 *   - Should the spec assert specific `match_method` values, or just that
 *     SOME edge was created? Spec sketch above pins `doi` for paper-A→B
 *     and recommends a second case w/ DOI-less title-fuzzy match.
 *   - Test data cleanup: per-test users (uniqueEmail()) sidestep cross-run
 *     pollution, but verify the cascade DELETE on user wipes
 *     paper_citations + document_references.
 */
import { test } from "@playwright/test";

test.skip("paper_citations auto-link: paper A's DOI ref resolves to uploaded paper B", () => {
  // Implementation deferred — see harness gaps in module docstring.
});

test.skip("paper_citations rematch: re-running auto-link is idempotent", () => {
  // Implementation deferred — see harness gaps in module docstring.
});

test.skip("paper_citations user-scoping: edges do not leak across users", () => {
  // Implementation deferred — see harness gaps in module docstring.
});
