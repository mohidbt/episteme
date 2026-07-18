const USE_CASES = [
  {
    lead: "An assistant with your full context.",
    body: "Reading a paper, you spot a link to something from last week. Ask, and it finds the paper, links your thoughts, writes the note.",
  },
  {
    lead: "Reading becomes a diff against your worldview.",
    body: "Add a new paper, ask the agents to highlight every line pink that touches what you already believe. See what is new, what conflicts, instantly.",
  },
  {
    lead: "Skim 50 papers at once.",
    body: "Need the methodology across fifty papers? Ask once. It works through all of them and hands back a table.",
  },
  {
    lead: "A story you can trace, and hand over.",
    body: "Every claim links back through paper to paper to reference. Trace any idea to its source. Hand your whole library to the next researcher, intact.",
  },
];

export function UseCases() {
  return (
    <section className="mk-usecases">
      <div className="mk-usecases-head">
        <div className="mk-eyebrow">What that looks like</div>
        <h2 className="mk-h2">
          Work that was <span className="mk-h2-italic">not possible before.</span>
        </h2>
      </div>
      <div className="mk-usecase-grid">
        {USE_CASES.map((uc) => (
          <article key={uc.lead} className="mk-usecase">
            <h3 className="mk-usecase-lead">{uc.lead}</h3>
            <p className="mk-usecase-body">{uc.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
