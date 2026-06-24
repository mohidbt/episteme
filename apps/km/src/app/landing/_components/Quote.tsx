export function Quote() {
  return (
    <section className="mk-quote">
      <div className="mk-quote-mark" aria-hidden="true">
        "
      </div>
      <blockquote className="mk-quote-text">
        <span className="italic">Ἐπιστήμη</span>: knowledge that is grasped,
        reasoned, and held against the world.
      </blockquote>
      <div className="mk-quote-attr">Aristotle · Nicomachean Ethics, VI</div>
    </section>
  );
}
