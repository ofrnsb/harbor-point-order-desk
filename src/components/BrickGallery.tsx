"use client";
// Dev-only gallery at /dev/bricks: every brick the agent builds answers from, on its own and in every variant, at
// phone width and at the conversation's width. No assembled answers here: one brick per frame.
import { DEV } from "@/copy/ui-dev";
import { BrickView } from "./bata/Bata";
import { BRICK_GALLERY } from "./bata/gallery";

const ctx = { onSelect: () => {}, onAsk: () => {}, onActionDone: () => {}, selected: "", latest: false };

export function BrickGallery({ only }: { only?: string }) {
  const words = only?.split(",").map((w) => w.trim()).filter(Boolean) ?? [];
  const groups = BRICK_GALLERY.filter((g) => !words.length || words.includes(g.brick));
  return (
    <main className="ap-preview ap-stress ap-bricks">
      <header className="ap-preview-head">
        <h1>{DEV.bricks.title}</h1>
        <p>{DEV.bricks.intro(BRICK_GALLERY.length, BRICK_GALLERY.reduce((n, g) => n + g.cases.length, 0))}</p>
        <nav className="ap-bricks-index" aria-label={DEV.bricks.index}>
          {BRICK_GALLERY.map((g) => <a key={g.brick} href={`#brick-${g.brick}`}>{g.title}<small>{g.cases.length}</small></a>)}
        </nav>
      </header>
      {groups.map((g) => (
        <section key={g.brick} id={`brick-${g.brick}`} className="ap-preview-item" data-brick={g.brick}>
          <h2 className="ap-bricks-name">{g.title} <code>{g.brick}</code></h2>
          <p className="ap-preview-empty">{g.about}</p>
          {(["phone", "column"] as const).map((w) => (
            <div key={w} className="ap-bricks-strip" data-width={w}>
              <h3 className="ap-preview-name">{w === "phone" ? DEV.bricks.phone : DEV.bricks.column}</h3>
              <div className="ap-bricks-cases">
                {g.cases.map((c) => (
                  <figure key={c.id} className="ap-brick-case" data-case={c.id} data-problem={c.problem ? true : undefined}>
                    <figcaption>{c.label}</figcaption>
                    <div className="ap-brick-surface">
                      {c.block && c.block.type === "bata" ? <BrickView b={c.block} ctx={ctx} /> : <p className="ap-brick-problem">{c.problem}</p>}
                    </div>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
