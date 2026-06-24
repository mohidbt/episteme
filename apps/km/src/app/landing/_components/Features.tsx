const REPLACED_TOOLS = ["Obsidian", "Zotero", "Acrobat", "ChatGPT"];

function ToolList() {
  return (
    <div className="mk-tool-stack">
      <div className="mk-tool-row">
        {REPLACED_TOOLS.map((name) => (
          <div key={name} className="mk-tool-chip">
            {name}
          </div>
        ))}
      </div>
      <div className="mk-tool-arrow" aria-hidden="true">
        ↓
      </div>
      <div className="mk-tool-after">
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
        <span className="mk-pill on">Assistant</span>
        <span className="mk-pill">your library</span>
      </div>
      <div className="mk-chat">
        <div className="mk-chat-bub user">
          <div className="mk-chat-who">You</div>
          Link this to what I read last week.
        </div>
        <div className="mk-chat-bub agent">
          <div className="mk-chat-who">Assistant</div>
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
            Obsidian for notes. Zotero for references. Acrobat for PDFs. ChatGPT
            for questions. Plus folders, tabs, bookmarks, screenshots, and
            citation chains held together by hand. Nothing knows about anything
            else.
          </p>
          <p className="mk-feat-body">
            Episteme puts your papers, references, highlights, notes, and reading
            in one place. One library. One map of what you know.
          </p>
          <p className="mk-feat-points">
            Read PDFs · Write linked notes · Manage references. All in one place.
          </p>
        </div>
        <div className="mk-feat-art">
          <ToolList />
        </div>
      </section>

      {/* Row 02 (reversed): the unlock */}
      <section className="mk-feat rev">
        <div className="mk-feat-text">
          <div className="mk-eyebrow">The unlock</div>
          <h2 className="mk-h2">
            Because it's all in one place, an assistant can{" "}
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
