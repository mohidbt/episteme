import { CtaRow } from "./CtaRow";

export function Hero() {
  return (
    <section className="mk-hero">
      <h1 className="mk-h1">
        Replace Obsidi*n, Z*tero, Acrob*t, and Ch*tGPT with{" "}
        <span className="mk-h1-italic">one workspace.</span>
      </h1>

      <p className="mk-sub">
        Papers, references, highlights, notes, and reading, unified. No more
        context switching.
      </p>
      <p className="mk-agent-line">
        Perfect context for AI agents. They work off your tasks, like you would.
      </p>

      <CtaRow />

      <p className="mk-hero-badge">Limited beta - Invite only</p>

      <div className="mk-hero-shot">
        <div className="mk-shot-chrome">
          <span />
          <span />
          <span />
        </div>
        <div className="mk-shot-body">
          <div className="mk-shot-side">
            <div className="row hd">Library</div>
            <div className="row a">Foundation models</div>
            <div className="row">Diffusion</div>
            <div className="row">Mechanistic interpretability</div>
            <div className="row faint">References (132)</div>
            <div className="row faint">Notes (23)</div>
          </div>
          <div className="mk-shot-main">
            <div className="mk-shot-doc">
              <div className="t-micro">Notes / Foundation models</div>
              <div className="title">Scaling laws: what survives</div>
              <div className="meta">Updated 4m ago · 12 references</div>
              <p className="p">
                Reading{" "}
                <span className="link">[[@kaplan2020scaling]]</span> alongside
                Chinchilla. Two threads worth pulling on.
              </p>
              <p className="p">
                Compute-optimal frontier shifts when data quality dominates{" "}
                <span className="cite">[12]</span>
              </p>
              <p className="p">
                The "irreducible loss" floor in{" "}
                <span className="cite">[7]</span> looks like a measurement
                artifact
              </p>
            </div>
          </div>
          <div className="mk-shot-agent">
            <div className="row hd">Agent</div>
            <div className="bub">Summarise the new paper and tag it.</div>
            <div className="tool">load_skill · cite-paper</div>
            <div className="tool">search_library("scaling 2026")</div>
            <div className="bub a">
              Added @scaling2026frontier to your library, linked it to two notes,
              and tagged it.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
