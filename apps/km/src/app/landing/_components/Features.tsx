import { FileText, NotebookPen, BookMarked, type LucideIcon } from "lucide-react";

// File-storm illustration: papers, notes, and references (the three episteme
// file types, using the app's own icons) fly in like a mess and resolve into
// the Episteme banner below.
type StormFile = { name: string; kind: "paper" | "note" | "reference"; Icon: LucideIcon };
const STORM_FILES: StormFile[] = [
  { name: "attention.pdf", kind: "paper", Icon: FileText },
  { name: "ideas.note", kind: "note", Icon: NotebookPen },
  { name: "kaplan2020.ref", kind: "reference", Icon: BookMarked },
  { name: "scaling-laws.pdf", kind: "paper", Icon: FileText },
  { name: "method.note", kind: "note", Icon: NotebookPen },
  { name: "chinchilla.ref", kind: "reference", Icon: BookMarked },
  { name: "review.note", kind: "note", Icon: NotebookPen },
  { name: "vaswani2017.ref", kind: "reference", Icon: BookMarked },
];

function FileStorm() {
  return (
    <div className="mk-storm">
      <div className="mk-storm-cloud">
        {STORM_FILES.map(({ name, kind, Icon }, i) => (
          <div key={name} className={`mk-file mk-file-${kind} mk-file-${i}`}>
            <Icon className="mk-file-ic" size={14} aria-hidden="true" />
            <span>{name}</span>
          </div>
        ))}
      </div>
      <div className="mk-storm-arrow" aria-hidden="true">
        ↓
      </div>
      <div className="mk-storm-banner">
        <span className="mk-mark">ε</span>
        <span>Episteme</span>
      </div>
    </div>
  );
}

function AgentChat() {
  return (
    <div className="mk-skill">
      <div className="mk-skill-head">
        <span className="mk-pill on">Agent</span>
      </div>
      <div className="mk-chat">
        <div className="mk-chat-bub user">
          <div className="mk-chat-who">You</div>
          Link this to what I read last week.
        </div>
        <div className="mk-chat-bub agent">
          <div className="mk-chat-who">Agent</div>
          Found the Chinchilla paper. Linked your note and drafted the
          connection.
        </div>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <div className="mk-features">
      {/* Row 01: the mess today -> what episteme is */}
      <section className="mk-feat">
        <div className="mk-feat-text">
          <div className="mk-eyebrow">The mess today</div>
          <h2 className="mk-h2">
            Your research is scattered across{" "}
            <span className="mk-h2-italic">five tools.</span>
          </h2>
          <p className="mk-feat-body">
            Obsidi*n for notes. Z*tero for references. Acrob*t for PDFs. Ch*tGPT
            for questions. Plus folders, tabs, bookmarks, screenshots, and
            citation chains held together by hand. Nothing knows about anything
            else.
          </p>
          <p className="mk-feat-body">
            Episteme puts your papers, references, highlights, notes, and reading
            in one place. One library. One map of what you know.
          </p>
          <p className="mk-feat-points">
            Read PDFs, write linked notes, and manage references, all in one
            place.
          </p>
        </div>
        <div className="mk-feat-art">
          <FileStorm />
        </div>
      </section>

      {/* Row 02 (reversed): the unlock */}
      <section className="mk-feat rev">
        <div className="mk-feat-text">
          <div className="mk-eyebrow">The unlock</div>
          <h2 className="mk-h2">
            Because it&apos;s all in one place, an assistant can{" "}
            <span className="mk-h2-italic">actually help.</span>
          </h2>
          <p className="mk-feat-body">
            When your whole research context lives together, you get an assistant
            that knows all of it, not a chatbot you paste into. It reads, links,
            highlights, and writes across your entire library. It finds
            connections you would miss, and does work that was not possible
            before.
          </p>
        </div>
        <div className="mk-feat-art">
          <AgentChat />
        </div>
      </section>
    </div>
  );
}
